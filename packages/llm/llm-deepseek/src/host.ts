/** Shared Host wiring for the DeepSeek protocol adapter. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-fs'
import { resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle } from '@deepseek-ai/dsh-llm'
import { getOrCreateAnonymousUserId, type AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { DeepSeekAdapter } from './adapter.ts'
import type { DeepSeekAdapterOptions, DeepSeekConnectionOptions } from './types.ts'

/**
 * Register one provider with request-local transport services and live retry policy.
 * @param ctx - provider plugin lifetime with the LLM registry injected.
 * @param provider - exact route owned by this plugin.
 * @param dependencies - provider-owned discovery, credential, and configuration callbacks.
 *   `enabled` optionally gates the whole route: a disabled provider holds no routes, which
 *   removes it from the model picker and the provider directory while its settings section
 *   and Models-page row stay in place, and re-checks on every volatile config update.
 */
export function registerDeepSeekProvider<C extends DeepSeekConnectionOptions>(
  ctx: Context, provider: string, dependencies: Pick<DeepSeekAdapterOptions<C>,
  'options' | 'resolveAuth' | 'providerName' | 'discoverModels'> & { enabled?: () => boolean }): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  let userId: AnonymousUserId | undefined
  const adapter = new DeepSeekAdapter({
    ...dependencies,
    resolveUserId: () => userId ??= getOrCreateAnonymousUserId(),
    onReplayDegrade: ({ provider, model, reason }) => {
      ctx.logger.warn(`llm-deepseek: unusable Messages replay state on assistant history for route "${provider}/${model}"; sending provider-neutral content (${reason})`)
    },
    onExtensionsOmitted: ({ provider, model, fields, error }) => {
      ctx.logger.warn(`llm-deepseek: sending route "${provider}/${model}" without request extension fields ${fields.join(', ')} because they failed to serialize: %o`, error)
    },
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments, hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref,
    ),
    prepareExtensions: request => ctx.get('deepseekLlmApiExtensions')?.prepare(request)
      ?? Promise.resolve({ fields: {}, accept: () => Promise.resolve() }),
  })
  const enabled = dependencies.enabled ?? (() => true)
  let registration: AdapterRegistrationHandle | undefined
  let holdingRoutes = false
  let registeredPolicy = dependencies.options().retryPolicy
  /**
   * Keep the route set in step with configuration. `registerAdapter` refuses an
   * empty route set, so a provider disabled from the start defers registration
   * until configuration asks for its route; a later disable replaces the routes
   * with an empty set instead of disposing the registration.
   */
  const syncRoutes = (): void => {
    if (!enabled()) {
      if (holdingRoutes) {
        registration?.replace([])
        holdingRoutes = false
      }
      return
    }
    let policy: typeof registeredPolicy
    try { policy = dependencies.options().retryPolicy }
    catch (error) {
      // A stored config the resolver refuses keeps the current registration; each request fails on its own resolve.
      ctx.logger.warn(error)
      return
    }
    if (registration === undefined) {
      registration = ctx.llm.registerAdapter([provider], adapter)
      holdingRoutes = true
      registeredPolicy = policy
      return
    }
    if (holdingRoutes && deepEqualJson(policy, registeredPolicy)) return
    // The registry captures the retry policy at registration, so it is the one
    // fact per-request resolution cannot refresh. `replace` re-reads it in one
    // synchronous registry section: disposing and re-registering instead would
    // publish an empty route set between the two, and re-enabling takes the
    // same path, so a provider that comes back is never briefly absent.
    registration.replace([provider])
    holdingRoutes = true
    registeredPolicy = policy
  }
  syncRoutes()
  ctx.on('loader/volatile-update', syncRoutes)
}
