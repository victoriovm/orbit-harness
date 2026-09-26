// @vitest-environment jsdom
/** The shipped plugin body: attention moments over the real ports, the preference, and the General row. */
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { AttentionSoundRow } from '../src/client/AttentionSoundRow.tsx'
import { en, zh } from '../src/client/locales.ts'
import { ATTENTION_SOUND_NAMESPACE } from '../src/settings.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** One scripted media element whose playback is always refused, ending each attempt immediately. */
class RefusingAudio {
  constructor(readonly src: string) {}
  addEventListener(): void {}
  play(): Promise<void> { return Promise.reject(new Error('refused')) }
}

/** Mount the shipped apply over fake services and browser stubs. */
async function mounted({ enabled = true, pickOutcome = 'ok' }:
{ enabled?: boolean; pickOutcome?: 'ok' | 'empty' | 'error' } = {}) {
  vi.stubGlobal('Audio', RefusingAudio)
  const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  const ctx = new Context()
  const pick = vi.fn(async () => {
    if (pickOutcome === 'error') return { ok: false as const, error: { message: 'down', code: 'x' } }
    return pickOutcome === 'empty'
      ? { ok: true as const, value: undefined }
      : { ok: true as const, value: { name: 'a.mp3', data: new Uint8Array([1]) } }
  })
  const prefValue = createSnapshotStore(enabled)
  const setPref = vi.fn(async () => true)
  const booleanPreference = vi.fn(() => ({ value: prefValue, set: setPref }))
  ctx.provide('configForms', { booleanPreference } as never)
  const statusListeners = new Set<() => void>()
  const snapshot = { current: new Map<string, { running?: boolean; pendingInteraction?: unknown }>() }
  ctx.provide('uiSession', {
    sessionStatus: {
      getSnapshot: () => snapshot.current,
      subscribe: (listener: () => void) => {
        statusListeners.add(listener)
        return () => { statusListeners.delete(listener) }
      },
    },
  } as never)
  const eventListeners = new Map<string, Set<() => void>>()
  ctx.provide('remote', {
    $on: vi.fn((event: string, listener: () => void) => {
      if (!eventListeners.has(event)) eventListeners.set(event, new Set())
      eventListeners.get(event)!.add(listener)
      return () => { eventListeners.get(event)!.delete(listener) }
    }),
    attentionSounds: { pick },
  } as never)
  const injects: Array<{ name: string; register: () => unknown }> = []
  const registrations: Array<{ options: Record<string, unknown>; component: unknown }> = []
  ctx.provide('slots', {
    inject: vi.fn((name: string, register: () => unknown) => {
      injects.push({ name, register })
      return () => {}
    }),
    register: vi.fn((options: Record<string, unknown>, component: unknown) => {
      registrations.push({ options, component })
      return () => {}
    }),
  } as never)
  const registerLocale = vi.fn(() => () => {})
  ctx.provide('locale', { register: registerLocale } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return {
    ctx, pick, hasFocus, booleanPreference, setPref, snapshot, statusListeners, eventListeners, injects, registrations, registerLocale,
    fireStatus: (): void => { for (const listener of [...statusListeners]) listener() },
    fireError: (): void => { for (const listener of [...(eventListeners.get('api-session/error') ?? [])]) listener() },
    dispose: (): Promise<void> => ctx.fiber.dispose(),
  }
}

describe('ui-attention-sound apply', () => {
  it('registers the dictionaries, the moment subscriptions, and the General row', async () => {
    const m = await mounted()
    expect(m.registerLocale).toHaveBeenCalledWith('attentionSound', { zh, en })
    expect([...m.eventListeners.keys()]).toEqual(['api-session/error'])
    expect(m.injects.map(injection => injection.name)).toEqual(['settings.general.item'])
    m.injects[0]!.register()
    expect(m.registrations).toHaveLength(1)
    expect(m.registrations[0]!.options).toMatchObject({ name: 'settings.general.item', id: 'attention-sound', order: 16, locale: 'attentionSound' })
    expect(m.registrations[0]!.component).toBe(AttentionSoundRow)
    await m.dispose()
  })

  it('supplies the row inject face over the shared preference', async () => {
    const m = await mounted({ enabled: false })
    m.injects[0]!.register()
    const injected = (m.registrations[0]!.options.inject as () => {
      hooks: { enabled: { getSnapshot(): boolean } }
      setEnabled(enabled: boolean): Promise<void>
    })()
    expect(injected.hooks.enabled.getSnapshot()).toBe(false)
    await injected.setEnabled(true)
    expect(m.setPref).toHaveBeenCalledWith(true)
    await m.dispose()
  })

  it('reads the Host preference through this feature namespace', async () => {
    const m = await mounted()
    expect(m.booleanPreference).toHaveBeenCalledWith(ATTENTION_SOUND_NAMESPACE, 'enabled', { hostFallback: true, memoryStart: true })
    await m.dispose()
  })

  it('plays when a running Session stops, a pending interaction appears, or the Host errors', async () => {
    const m = await mounted()
    m.snapshot.current = new Map([['s1', { running: true }]])
    m.fireStatus()
    m.snapshot.current = new Map([['s1', { running: false }]])
    m.fireStatus()
    await vi.waitFor(() =>{  expect(m.pick).toHaveBeenCalledOnce() })
    await m.dispose()
  })

  it('plays when a pending interaction appears after the baseline', async () => {
    const m = await mounted()
    m.snapshot.current = new Map([['s1', { running: true }]])
    m.fireStatus()
    m.snapshot.current = new Map([['s1', { running: true, pendingInteraction: { key: 'k', kind: 'approval' } }]])
    m.fireStatus()
    await vi.waitFor(() =>{  expect(m.pick).toHaveBeenCalledOnce() })
    await m.dispose()
  })

  it('plays when the Host reports an error even without a transition', async () => {
    const m = await mounted()
    m.fireError()
    await vi.waitFor(() =>{  expect(m.pick).toHaveBeenCalledOnce() })
    await m.dispose()
  })

  it('tolerates a failed Host pick and an absent sound without playing or throwing', async () => {
    const failed = await mounted({ pickOutcome: 'error' })
    failed.fireError()
    await vi.waitFor(() =>{  expect(failed.pick).toHaveBeenCalledOnce() })
    await failed.dispose()
    const empty = await mounted({ pickOutcome: 'empty' })
    empty.fireError()
    await vi.waitFor(() =>{  expect(empty.pick).toHaveBeenCalledOnce() })
    await empty.dispose()
  })

  it('stays silent while the Host preference disables playback', async () => {
    const m = await mounted({ enabled: false })
    m.snapshot.current = new Map([['s1', { running: true }]])
    m.fireStatus()
    m.snapshot.current = new Map([['s1', { running: false }]])
    m.fireStatus()
    m.fireError()
    await vi.waitFor(() => {})
    expect(m.pick).not.toHaveBeenCalled()
    await m.dispose()
  })

  it('stops alerting after disposal', async () => {
    const m = await mounted()
    expect(m.statusListeners.size).toBeGreaterThan(0)
    await m.dispose()
    expect(m.statusListeners.size).toBe(0)
    expect([...m.eventListeners.values()].every(listeners => listeners.size === 0)).toBe(true)
    m.fireStatus()
    m.fireError()
    expect(m.pick).not.toHaveBeenCalled()
  })
})
