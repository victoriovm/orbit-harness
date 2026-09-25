/**
 * Per-session model directory: the ONE state both selection entries share.
 * The /model popup and composer seat combine one shared Host catalog with the
 * Session's durable selection projection, then submit through the same
 * selectModel call. A switch made in either entry updates this shared state,
 * and both build the submission from the shared route-to-effort memory, so a
 * model keeps the level it was last used at.
 */
import type {
  ModelCatalogFailure, ModelCatalogModel, ModelProviderGroup, ModelSelection, ModelSelectionProjection,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult, TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelCatalogDirectory } from './catalog.ts'
import type { ModelEffortMemory } from './effort-memory.ts'

/** Directory snapshot both entries render from. */
export interface ModelDirectoryState {
  /** Saved selection, retained even when its provider or model leaves the catalog. */
  current: ModelSelection | null
  /** Saved effort caption retained when the selected model is unavailable. */
  retainedEffort?: string
  /** Whether the current selection is present in the available catalog; null while unresolved. */
  routable: boolean | null
  /** Successfully loaded provider groups (last good load). */
  groups: readonly ModelProviderGroup[]
  /** Provider-local failures from the last load; usable groups stay usable. */
  failures: readonly ModelCatalogFailure[]
  /** Lifecycle of the in-flight operation. */
  status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'
  /** Selection submitted by the latest `select` until it settles; null otherwise. */
  pending: ModelSelection | null
  /** Whole-request or selection failure text; null when none. */
  error: string | null
}

/** One session's shared directory controller; disposed with the session scope. */
export class ModelDirectory {
  /** The shared snapshot both entries render from (uSES-safe store). */
  readonly store: SnapshotStore<ModelDirectoryState> = createSnapshotStore<ModelDirectoryState>({
    current: null, routable: null, groups: [], failures: [], status: 'idle', pending: null, error: null,
  })

  /** Latest selection operation wins; an older response never overwrites a newer one. */
  private generation = 0
  private disposed = false
  private readonly unsubscribeCatalog: () => void
  private readonly unsubscribeSelection: () => void

  /**
   * @param sessions - the session wire face (captured from the plugin's root connection).
   * @param sessionId - the owning session.
   * @param available - whether this session may use Agent-bound model RPCs.
   * @param catalog - Host-generation catalog shared by every Session.
   * @param projected - durable model selection projected from Session history.
   * @param efforts - route-to-effort memory shared by every Session.
   */
  constructor(
    private readonly sessions: Pick<TypertClientRemote['session'], 'selectModel'>,
    private readonly sessionId: SessionId,
    private readonly available: () => boolean,
    private readonly catalog: ModelCatalogDirectory,
    private readonly projected: ObservableSnapshot<unknown>,
    private readonly efforts: ModelEffortMemory,
  ) {
    this.unsubscribeCatalog = catalog.store.subscribe(() => { this.syncInputs() })
    this.unsubscribeSelection = projected.subscribe(() => { this.syncInputs() })
    this.syncInputs()
  }

  /**
   * Ensure the Host generation's shared available catalog is loaded.
   * @returns the fresh directory value.
   */
  async load(): Promise<ModelDirectoryState> {
    this.assertAvailable()
    await this.catalog.load()
    this.syncInputs()
    return this.store.getSnapshot()
  }

  /**
   * Select the complete provider/model/reasoning selection. The durable
   * projection frame updates the shared current; failures surface on the store
   * and return with the operation so each entry can present its own failure.
   * The route being left keeps its effort in the shared memory, which is what
   * a later switch back to that model submits.
   * @param selection - provider, provider-owned model id, and optional adapter-owned effort.
   * @returns the selection outcome, including the original Remote failure.
   */
  async select(selection: ModelSelection): Promise<RemoteResult<void>> {
    this.assertAvailable()
    const generation = ++this.generation
    this.rememberCurrentEffort()
    this.store.update((s) => { s.status = 'selecting'; s.pending = selection; s.error = null })
    const result = await this.sessions.selectModel({
      sessionId: this.sessionId,
      provider: selection.provider,
      model: selection.model,
      ...selection.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: selection.reasoningEffort },
    })
    if (this.disposed || generation !== this.generation) {
      return result.ok ? { ok: true, value: undefined } : result
    }
    if (!result.ok) {
      this.store.update((s) => {
        s.status = 'error'
        s.pending = null
        s.error = `${result.error.code}: ${result.error.message}`
      })
      return result
    }
    this.store.update((s) => { s.status = 'ready'; s.pending = null; s.error = null })
    this.syncInputs()
    return { ok: true, value: undefined }
  }

  /**
   * The selection a catalog row submits: the effort this client last had in
   * effect for that route while the model still advertises it, otherwise the
   * model's own default. Re-picking the route already in use keeps the
   * Session's effort. A remembered level the model no longer advertises is
   * dropped rather than submitted — the Host rejects unknown levels.
   * @param group - the provider group that owns the row.
   * @param model - the catalog row.
   * @returns the row's complete selection.
   */
  selectionFor(group: ModelProviderGroup, model: ModelCatalogModel): ModelSelection {
    const current = this.store.getSnapshot().current
    const sameRoute = current?.provider === group.id && current.model === model.id
    const effort = (sameRoute ? current.reasoningEffort : undefined)
      ?? this.rememberedEffort(group.id, model)
      ?? model.reasoning?.defaultEffort
    return {
      provider: group.id,
      model: model.id,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }
  }

  /**
   * Invalidate an in-flight selection response from the previous Host generation.
   */
  resetConnected(): void {
    if (this.disposed) return
    ++this.generation
    this.store.update((state) => {
      if (state.status === 'selecting') state.status = 'idle'
      state.pending = null
      state.error = null
    })
    this.syncInputs()
  }

  /** Scope teardown: late settlements lose write access to the store. */
  dispose(): void {
    this.disposed = true
    this.unsubscribeSelection()
    this.unsubscribeCatalog()
  }

  private assertAvailable(): void {
    if (!this.available()) {
      throw new Error('model selection is unavailable for addressed subagent sessions')
    }
  }

  /** Record the Session's own effort for its route, so returning to that model restores it. */
  private rememberCurrentEffort(): void {
    const current = this.store.getSnapshot().current
    if (current?.reasoningEffort !== undefined) {
      this.efforts.remember(current.provider, current.model, current.reasoningEffort)
    }
  }

  /**
   * @param providerId - the route's provider.
   * @param model - the catalog row whose advertised levels decide the value.
   * @returns the remembered effort, while the model still advertises it.
   */
  private rememberedEffort(providerId: string, model: ModelCatalogModel): string | undefined {
    const remembered = this.efforts.recall(providerId, model.id)
    const offered = model.reasoning?.efforts.some(effort => effort.id === remembered) ?? false
    return remembered !== undefined && offered ? remembered : undefined
  }

  private syncInputs(): void {
    if (this.disposed) return
    const catalog = this.catalog.store.getSnapshot()
    const projected = modelSelectionProjection(this.projected.getSnapshot())
    const intended = projected?.next ?? catalog.value?.default
    const reasoning = intended === undefined ? undefined : this.catalog.reasoningFor(intended)
    const effort = intended?.reasoningEffort ?? reasoning?.defaultEffort
    const retainedEffort = effort === undefined ? undefined
      : reasoning?.efforts.find(level => level.id === effort)?.name ?? effort
    if (catalog.status !== 'ready' || catalog.value === null || projected === undefined) {
      this.store.set({
        current: catalog.value === null ? null : this.store.getSnapshot().current,
        ...retainedEffort === undefined ? {} : { retainedEffort },
        routable: null,
        groups: catalog.value?.groups ?? [],
        failures: catalog.value?.failures ?? [],
        status: catalog.status === 'error' ? 'error' : 'loading',
        pending: this.store.getSnapshot().pending,
        error: catalog.error,
      })
      return
    }
    const selection = projected.next ?? catalog.value.default
    const routable = catalog.value.groups.some(group => group.id === selection.provider
      && group.models.some(model => model.id === selection.model))
    this.store.set({
      current: selection,
      ...retainedEffort === undefined ? {} : { retainedEffort },
      routable,
      groups: catalog.value.groups,
      failures: catalog.value.failures,
      status: this.store.getSnapshot().status === 'selecting'
        ? 'selecting'
        : 'ready',
      pending: this.store.getSnapshot().pending,
      error: null,
    })
  }
}

function modelSelectionProjection(value: unknown): ModelSelectionProjection | undefined {
  return value === undefined ? undefined : value as ModelSelectionProjection
}
