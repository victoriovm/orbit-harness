/**
 * ModelSelect's injected face. The target 'conversation.input.model' seat is
 * declared (children table) and typed by ui-conversation's composer-bar
 * entry; this package only contributes the single occupant, so no SlotMap
 * merge lives here.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelCatalogModel, ModelProviderGroup } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectoryState } from './directory.ts'

/** One provider route the auto-configuration action can serve. */
export interface AutoConfigureProvider {
  /** Provider route id submitted to the Host. */
  readonly id: string
  /** Settings namespace owning that route's profile, as the Host addressed it. */
  readonly settingsNs: string
  /** Name the dropdown shows for that route. */
  readonly name: string
}

/** What one auto-configuration attempt produced. */
export type AutoConfigureOutcome =
  /**
   * The route's stored profile now holds this many models, of which this many
   * a public catalog described; the rest came from the endpoint alone.
   */
  | { readonly kind: 'configured'; readonly models: number; readonly enriched: number }
  /** The attempt produced nothing; the message says why. */
  | { readonly kind: 'failed'; readonly message: string }

/** The routes this Host can auto-configure, or why none could be listed. */
export type AutoConfigureProviderList =
  /** The routes, ready to fill the dropdown. */
  | { readonly kind: 'listed'; readonly providers: readonly AutoConfigureProvider[] }
  /** The directory could not be read; the message says why. */
  | { readonly kind: 'failed'; readonly message: string }

/** Injected business face of the composer model seat. */
export interface ModelSelectInjected {
  /** Whether this session supports Agent-bound model inspection and selection. */
  available: boolean
  /** The session's shared directory store (same instance the /model popup reads). */
  directory: SnapshotStore<ModelDirectoryState>
  /** Ensure the shared advisory catalog is loaded (errors land on the store). */
  load: () => void
  /**
   * The selection one catalog row submits, carrying the effort the shared
   * route-to-effort memory holds for it (see `ModelDirectory.selectionFor`).
   * @param group - the provider group that owns the row.
   * @param model - the catalog row.
   * @returns the row's complete selection to submit.
   */
  selectionFor: (group: ModelProviderGroup, model: ModelCatalogModel) => ModelSelection
  /**
   * Select a complete provider/model/reasoning selection.
   * @param selection - model selection and optional adapter-owned effort.
   * @returns the Host outcome, or undefined when this Session cannot select a model.
   */
  select: (selection: ModelSelection) => Promise<RemoteResult<void> | undefined>
  /**
   * The registered provider routes whose stored profile this Host can rebuild
   * from the route's own endpoint.
   * @returns the routes in directory order, or the failure that prevented listing them.
   */
  autoConfigurableProviders: () => Promise<AutoConfigureProviderList>
  /**
   * Rebuild one route's model list from its endpoint and the public model
   * catalog, storing the result in the route's own profile.
   * @param provider - the route to reconfigure.
   * @returns what the attempt produced, ready to render.
   */
  autoConfigure: (provider: AutoConfigureProvider) => Promise<AutoConfigureOutcome>
}
