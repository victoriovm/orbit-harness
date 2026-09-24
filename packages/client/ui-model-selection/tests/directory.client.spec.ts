/**
 * ModelDirectory's effort rule: the selection a catalog row submits carries
 * the level this client last had in effect for that route, so switching to
 * another model and back keeps the level the user chose instead of resetting
 * to the model's default. Real catalog directory and real route-to-effort
 * memory over fake Host faces, one session per bench.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  ModelCatalog, ModelProviderGroup, ModelSelection, ModelSelectionProjection,
} from '@deepseek-ai/dsh-api-session-controller/types'
import { ModelCatalogDirectory } from '../src/client/catalog.ts'
import { ModelDirectory } from '../src/client/directory.ts'
import { ModelEffortMemory } from '../src/client/effort-memory.ts'

const sid = (key: string): SessionId => key as SessionId

const FLASH_EFFORTS = [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }]

/** Flash reasons at off/high/max (default high); Pro offers max; Quiet offers no levels at all. */
function groups(flashEfforts = FLASH_EFFORTS): readonly ModelProviderGroup[] {
  return [{
    id: 'deepseek-official',
    name: 'DeepSeek',
    models: [
      {
        id: 'deepseek-v4-flash',
        name: 'Flash',
        reasoning: { efforts: flashEfforts, defaultEffort: 'high' },
      },
      { id: 'deepseek-v4-pro', name: 'Pro', reasoning: { efforts: [{ id: 'max', name: 'Max' }], defaultEffort: 'max' } },
      { id: 'quiet', name: 'Quiet' },
    ],
  }]
}

/**
 * Boot one session's directory over a stateful fake Host: a successful
 * selectModel installs the selection on the Session projection, which is what
 * the directory's `current` follows.
 * @param options - catalog rows, Host default route, initial projection, or skip the catalog load.
 * @returns the directory, its collaborators, and what a test reads back.
 */
async function bench(options: {
  groups?: readonly ModelProviderGroup[]
  default?: ModelSelection
  projection?: ModelSelectionProjection
  unloaded?: boolean
} = {}) {
  const ctx = new Context()
  // A lane without web storage keeps every bench in-process; where the lane has
  // it, each bench still starts from a client that remembers no level.
  globalThis.localStorage?.clear()
  const host = {
    groups: options.groups ?? groups(),
    default: options.default ?? { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  }
  const projected = createSnapshotStore<ModelSelectionProjection | undefined>(
    options.projection ?? { lastUsed: null, next: null })
  const sessionRemote = {
    modelCatalog: (): Promise<{ ok: true; value: ModelCatalog }> => Promise.resolve({
      ok: true,
      value: {
        default: host.default,
        routableProviders: ['deepseek-official'],
        groups: host.groups,
        failures: [],
      },
    }),
    selectModel: (payload: {
      sessionId: SessionId
      provider: string
      model: string
      reasoningEffort?: string
    }): Promise<{ ok: true; value: { selected: ModelSelection } }> => {
      // The Host materializes the model's default when the client submits no
      // level, so the projection carries the level actually in effect.
      const routed = host.groups.find(group => group.id === payload.provider)
        ?.models.find(model => model.id === payload.model)
      const effort = payload.reasoningEffort ?? routed?.reasoning?.defaultEffort
      const selected: ModelSelection = {
        provider: payload.provider,
        model: payload.model,
        ...effort === undefined ? {} : { reasoningEffort: effort },
      }
      projected.set({ lastUsed: null, next: selected })
      return Promise.resolve({ ok: true, value: { selected } })
    },
  }
  new TestRemote(ctx, { session: sessionRemote })
  const catalog = new ModelCatalogDirectory(ctx)
  const efforts = new ModelEffortMemory()
  const directory = new ModelDirectory(
    sessionRemote, sid('s1'), () => true, catalog, projected, efforts)
  if (options.unloaded !== true) await directory.load()
  const find = (modelId: string) => {
    const group = directory.store.getSnapshot().groups.find(candidate =>
      candidate.models.some(model => model.id === modelId))!
    return { group, model: group.models.find(model => model.id === modelId)! }
  }
  return {
    directory,
    catalog,
    efforts,
    host,
    /** The selection the picker submits for one model row. */
    selectionFor: (modelId: string) => {
      const { group, model } = find(modelId)
      return directory.selectionFor(group, model)
    },
  }
}

describe('ModelDirectory.selectionFor', () => {
  it('submits the model default for a route this client has seen no level for', async () => {
    const b = await bench()
    expect(b.selectionFor('deepseek-v4-flash')).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    })
    expect(b.selectionFor('deepseek-v4-pro')).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    })
  })

  it('keeps the level of the model the user leaves and restores it on the way back', async () => {
    const b = await bench()
    await b.directory.select({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
    })

    // Away to Pro, which is where Flash's level is recorded...
    await b.directory.select({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    expect(b.efforts.recall('deepseek-official', 'deepseek-v4-flash')).toBe('max')
    expect(b.directory.store.getSnapshot().current).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    })

    // ...and back to Flash, which is where the level used to reset.
    expect(b.selectionFor('deepseek-v4-flash')).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
    })
  })

  it('keeps the Session level when the route in use is picked again', async () => {
    // The route became current without this client choosing for it (a Host
    // default, another client, or restored history), so only the Session knows.
    const b = await bench({
      projection: {
        lastUsed: null,
        next: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'max' },
      },
    })
    expect(b.efforts.recall('deepseek-official', 'deepseek-v4-pro')).toBeUndefined()
    expect(b.selectionFor('deepseek-v4-pro')).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    })
  })

  it('takes the model default once the remembered level is no longer advertised', async () => {
    const b = await bench()
    await b.directory.select({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
    })
    await b.directory.select({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })

    // The route narrowed its levels since that choice. The Host rejects an
    // unknown level, so the remembered one is dropped rather than submitted.
    b.host.groups = groups(FLASH_EFFORTS.slice(0, -1))
    b.catalog.refresh()
    await vi.waitFor(() => {
      expect(b.selectionFor('deepseek-v4-flash').reasoningEffort).toBe('high')
    })
    expect(b.efforts.recall('deepseek-official', 'deepseek-v4-flash')).toBe('max')
  })

  it('submits no effort for a model that advertises none, remembered or not', async () => {
    const b = await bench()
    expect(b.selectionFor('quiet')).toEqual({ provider: 'deepseek-official', model: 'quiet' })
    b.efforts.remember('deepseek-official', 'quiet', 'high')
    expect(b.selectionFor('quiet')).toEqual({ provider: 'deepseek-official', model: 'quiet' })
  })
})

describe('ModelDirectory effort recording', () => {
  it('records nothing for a Session route that carries no level', async () => {
    const b = await bench({
      projection: { lastUsed: null, next: { provider: 'deepseek-official', model: 'quiet' } },
    })
    // The row still answers while the Session is on a model without levels.
    expect(b.selectionFor('quiet')).toEqual({ provider: 'deepseek-official', model: 'quiet' })
    await b.directory.select({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'off',
    })
    expect(b.efforts.recall('deepseek-official', 'quiet')).toBeUndefined()
  })

  it('records a level picked without switching models, which the next switch away keeps', async () => {
    const b = await bench({
      projection: {
        lastUsed: null,
        next: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
      },
    })
    // An effort-only change is a selection like any other.
    await b.directory.select({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'off',
    })
    await b.directory.select({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    expect(b.efforts.recall('deepseek-official', 'deepseek-v4-flash')).toBe('off')
    expect(b.selectionFor('deepseek-v4-flash').reasoningEffort).toBe('off')
  })
})

describe('ModelDirectory before the catalog is loaded', () => {
  it('selects with nothing current and remembers nothing for the route', async () => {
    const b = await bench({ unloaded: true })
    expect(b.directory.store.getSnapshot().current).toBeNull()

    await expect(b.directory.select({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    })).resolves.toEqual({ ok: true, value: undefined })
    // No route was current to remember, and the projection this bench installs
    // cannot resolve without a catalog, so the directory stays unresolved.
    expect(b.efforts.recall('deepseek-official', 'deepseek-v4-pro')).toBeUndefined()
    expect(b.directory.store.getSnapshot().current).toBeNull()
  })
})

describe('ModelEffortMemory', () => {
  it('writes one route level and reads it back without touching the others', () => {
    const memory = new ModelEffortMemory()
    memory.remember('deepseek-official', 'deepseek-v4-flash', 'max')
    expect(memory.recall('deepseek-official', 'deepseek-v4-flash')).toBe('max')
    expect(memory.recall('deepseek-official', 'deepseek-v4-pro')).toBeUndefined()
    expect(memory.recall('other-provider', 'deepseek-v4-flash')).toBeUndefined()

    // The same level again is one stored entry, not a rewrite.
    const before = memory.store.getSnapshot()
    memory.remember('deepseek-official', 'deepseek-v4-flash', 'max')
    expect(memory.store.getSnapshot()).toBe(before)

    memory.remember('deepseek-official', 'deepseek-v4-flash', 'off')
    expect(memory.store.getSnapshot().efforts['deepseek-official']).toEqual({
      'deepseek-v4-flash': 'off',
    })
  })

  it('reads an entry of another type as absent', () => {
    const memory = new ModelEffortMemory()
    memory.store.set({ efforts: { provider: { model: 7 as unknown as string } } })
    expect(memory.recall('provider', 'model')).toBeUndefined()
  })

  it('carries the levels into a later instance of the same client', () => {
    const backing = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => { backing.set(key, value) },
      removeItem: (key: string) => { backing.delete(key) },
    })
    try {
      new ModelEffortMemory().remember('deepseek-official', 'deepseek-v4-flash', 'max')
      expect([...backing.keys()]).toEqual(['dsh.models.effort'])
      expect(new ModelEffortMemory().recall('deepseek-official', 'deepseek-v4-flash')).toBe('max')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
