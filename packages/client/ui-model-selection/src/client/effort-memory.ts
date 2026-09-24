/**
 * Route-to-effort memory: the reasoning level this client last had in effect
 * for each provider/model pair. Switching to another model and back submits
 * the remembered level for that route instead of the model's own default, so
 * leaving a model does not reset the level the user chose for it. One
 * persisted map is shared by every Session's directory: the level belongs to
 * the model, not to the Session that happened to pick it.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** The localStorage entry holding every route's remembered level. */
const EFFORT_MEMORY_KEY = 'dsh.models.effort'

/** Persisted route-to-effort map. */
export interface ModelEffortMemoryState {
  /** Provider id, then model id, to the effort id last in effect for that route. */
  efforts: Record<string, Record<string, string>>
}

/** The remembered reasoning level per model route, across Sessions and page loads. */
export class ModelEffortMemory {
  /** The persisted map; route reads go through {@link recall}. */
  readonly store: SnapshotStore<ModelEffortMemoryState> = createSnapshotStore<ModelEffortMemoryState>(
    { efforts: {} },
    { persist: { name: EFFORT_MEMORY_KEY } },
  )

  /**
   * Record the level one route is in effect at. The same value again writes
   * nothing, so a route re-observed on every switch does not touch storage.
   * @param providerId - the route's provider.
   * @param modelId - the provider-owned model id.
   * @param effort - the adapter-owned effort id in effect.
   */
  remember(providerId: string, modelId: string, effort: string): void {
    if (this.recall(providerId, modelId) === effort) return
    this.store.update((state) => {
      state.efforts[providerId] = { ...state.efforts[providerId], [modelId]: effort }
    })
  }

  /**
   * Read the level this client remembers for one route.
   * @param providerId - the route's provider.
   * @param modelId - the provider-owned model id.
   * @returns the remembered effort id, or undefined when this client has seen none.
   */
  recall(providerId: string, modelId: string): string | undefined {
    // Persisted state is a durable boundary: an entry written by another
    // version, or hand-edited, can hold anything — and only a level id counts.
    const effort: unknown = this.store.getSnapshot().efforts[providerId]?.[modelId]
    return typeof effort === 'string' ? effort : undefined
  }
}
