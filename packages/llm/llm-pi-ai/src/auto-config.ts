/**
 * One-action model configuration for a stored route: read the route's own
 * listing endpoint, enrich it with the public models.dev catalog, and answer
 * the `models` list its profile should hold.
 *
 * The endpoint is the only source of *membership*: every model the route
 * serves is configured, and no model it does not serve is invented from the
 * catalog. The catalog supplies what a listing rarely discloses — the
 * human-readable name and the reasoning levels a model accepts — and the
 * capacity facts a router may publish while flagging them as wrong.
 *
 * A listing's context window is used as reported, except where the entry
 * itself carries `context_misconfig: true`: the router is saying the number it
 * is required to publish does not describe the model, and only then does the
 * catalog's own figure replace it. Output caps follow the listing first and
 * the catalog second, because a router that reports one is describing the
 * route being configured.
 *
 * @module dsh-llm-pi-ai/auto-config
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import { THINKING_LEVELS } from './catalog.ts'
import type { PiAiModality } from './catalog.ts'
import { fetchModelListing, hasReadableListing, listingRecords } from './discovery.ts'
import type { ListingEntry } from './discovery.ts'
import {
  catalogContext, catalogEfforts, catalogInputs, catalogMaxTokens, catalogModelName, findCatalogModel,
} from './models-dev.ts'
import type { ModelsDevCatalog } from './models-dev.ts'

/**
 * One entry of the route's `models` list, in the shape settings store it.
 *
 * A type alias rather than an interface on purpose: the settings write takes
 * JSON, and only an object type literal carries the implicit index signature
 * that makes this assignable to one.
 */
export type ConfiguredModel = {
  id: string
  name: string
  contextWindow?: number
  maxTokens?: number
  input: string[]
  /** Absent leaves the capability unstated; `false` declares a non-reasoning model. */
  reasoningEfforts?: false | Record<string, string | null>
}

/** One route's rebuilt model list and the reasoning default that goes with it. */
export type ConfiguredRoute = {
  /** Models the endpoint disclosed, in endpoint order. */
  models: ConfiguredModel[]
  /**
   * How many of them the catalog described, so their names and levels came
   * from it. The rest are configured from the endpoint's listing alone, which
   * may be no more than an id and no reasoning level at all.
   */
  enriched: number
  /**
   * Level every reasoning-capable model on the route accepts, when one exists:
   * a route-wide default is only useful if no model can reject it.
   */
  reasoning?: ModelThinkingLevel
}

/** The route facts one auto-configuration reads. */
export interface AutoConfigureRoute {
  /** Registered route being reconfigured, for diagnostics. */
  readonly provider: string
  /** Endpoint the route serves its models from. */
  readonly baseURL?: string
  /** Wire protocol that endpoint speaks. */
  readonly api?: string
  /** Deployment-owned request headers configured on the route. */
  readonly headers?: Readonly<Record<string, string>>
}

/** Everything one auto-configuration reads. */
export interface AutoConfigureInput {
  /** The route being reconfigured. */
  readonly route: AutoConfigureRoute
  /** Resolve the route's stored credential, when its profile names one. */
  readonly resolveApiKey: () => Promise<string | undefined>
  /** Indexed models.dev catalog the listing is enriched against. */
  readonly catalog: ModelsDevCatalog
  /** Caller cancellation. */
  readonly signal?: AbortSignal
}

/** Effort spellings the Harness ladder ranks, lowest first — the order a default walks. */
const DEFAULT_EFFORT_PREFERENCE: readonly ModelThinkingLevel[] = ['medium', 'high', 'max']

/** A positive integer field of a listing entry, or `undefined`. */
function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/** The first positive integer among the candidate fields of one entry. */
function capacity(entry: ListingEntry, ...fields: readonly (keyof ListingEntry)[]): number | undefined {
  for (const field of fields) {
    const found = positiveInteger(entry[field])
    if (found !== undefined) return found
  }
  return undefined
}

/** The first non-empty string among the candidate fields of one entry. */
function text(entry: ListingEntry, ...fields: readonly (keyof ListingEntry)[]): string | undefined {
  for (const field of fields) {
    const value = entry[field]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
}

/** A listing entry's nested `capabilities` object, when the router publishes one. */
function entryCapabilities(entry: ListingEntry): Record<string, unknown> {
  const capabilities = entry.capabilities
  return capabilities !== null && typeof capabilities === 'object' && !Array.isArray(capabilities)
    ? capabilities as Record<string, unknown>
    : {}
}

/** A listing entry's nested `limit` object, when the router publishes one. */
function entryLimit(entry: ListingEntry): Record<string, unknown> {
  const limit = entry.limit
  return limit !== null && typeof limit === 'object' ? limit as Record<string, unknown> : {}
}

/**
 * The vendor name a router publishes for one model, which the display name
 * carries in parentheses: the vendor's own name when the router knows one, its
 * id otherwise.
 * @param entry - one listing entry.
 * @returns the vendor label, or `undefined` when the router names none.
 */
function ownerLabel(entry: ListingEntry): string | undefined {
  return text(entry, 'owned_by_name') ?? text(entry, 'owned_by')
}

/** The last segment of one model id, for naming a model nothing else describes. */
function lastSegment(id: string): string {
  const segments = id.split('/').map(part => part.trim()).filter(Boolean)
  return segments.length === 0 ? id : segments[segments.length - 1] as string
}

/**
 * The variant suffixes routers append to a base model id to publish one
 * adjustable facet of it as its own id ("gpt-5-high", "sonnet-agent"). The
 * catalog files the base model and nothing under these names, so a suffix is
 * what turns an unmatched id into a name its base model already has.
 */
const NAME_FALLBACK_SUFFIXES: readonly string[] = ['agent', 'high', 'low', 'medium', 'thinking']

/**
 * The name an id no catalog record covers still deserves, resolved through the
 * base model its variant suffix names.
 * @param id - the model id the endpoint reported.
 * @param catalog - the indexed models.dev catalog.
 * @returns the base model's name with the variant in parentheses, or `undefined`.
 */
function variantName(id: string, catalog: ModelsDevCatalog): string | undefined {
  const bare = id.trim().replace(/:free$/i, '')
  const suffix = NAME_FALLBACK_SUFFIXES.find(candidate => bare.toLowerCase().endsWith(`-${candidate}`))
  if (suffix === undefined) return undefined
  const baseId = bare.slice(0, -(suffix.length + 1))
  const named = catalogModelName(findCatalogModel(catalog, baseId)?.model)
  if (named === undefined) return undefined
  return `${named} (${suffix.charAt(0).toUpperCase()}${suffix.slice(1)})`
}

/**
 * The name one configured model carries: the catalog's, then the base model
 * the id's own variant suffix names, then the endpoint's, then the id.
 * @param id - the model id the endpoint reported.
 * @param entry - the entry the endpoint reported for it.
 * @param catalog - the indexed models.dev catalog.
 * @returns the display name, without the vendor parenthesis.
 */
function displayName(id: string, entry: ListingEntry, catalog: ModelsDevCatalog): string {
  const match = findCatalogModel(catalog, id)
  const named = catalogModelName(match?.model)
  if (named !== undefined) return named
  const variant = variantName(id, catalog)
  if (variant !== undefined) return variant
  const endpoint = text(entry, 'name', 'display_name', 'displayName')
  if (endpoint !== undefined) return endpoint
  return lastSegment(id)
}

/**
 * The context window one configured model carries. The listing answers unless
 * the entry flags its own figure as wrong, in which case only the catalog does.
 * @param entry - the entry the endpoint reported.
 * @param catalogContextWindow - the catalog record's own figure, when it has one.
 * @returns the context window, or `undefined` to leave the route's default.
 */
function contextWindowOf(entry: ListingEntry, catalogContextWindow: number | undefined): number | undefined {
  if (entry.context_misconfig === true) return catalogContextWindow
  return capacity(
    entry,
    'contextWindow',
    'context_window',
    'context_length',
    'max_input_tokens',
  ) ?? positiveInteger(entryLimit(entry)['context'])
}

/**
 * The request modalities one configured model declares. The router's own
 * `capabilities.vision` answers when it states one; otherwise the catalog's
 * modalities do, and text alone is the floor.
 */
function inputsOf(entry: ListingEntry, catalogInputsDeclared: readonly PiAiModality[]): PiAiModality[] {
  const vision = entryCapabilities(entry)['vision']
  if (vision === true) return ['text', 'image']
  if (vision === false) return ['text']
  if (catalogInputsDeclared.includes('image')) return ['text', 'image']
  return ['text']
}

/**
 * One model's reasoning declaration. A level map with no rung above `off` is
 * not a reasoning model this profile can express — the schema refuses a map
 * that offers nothing to select — so it is stored as the explicit denial.
 * @param entry - the entry the endpoint reported.
 * @param efforts - the levels the catalog declares, keyed by Harness level.
 * @returns the field to store, or `undefined` to leave the capability unstated.
 */
function reasoningEffortsOf(
  entry: ListingEntry,
  efforts: Readonly<Record<string, string | null>>,
): false | Record<string, string | null> | undefined {
  const rungs = Object.keys(efforts).filter(level => level !== 'off')
  if (rungs.length > 0) return { ...efforts }
  // Only the endpoint may deny reasoning outright; a catalog record that
  // simply declares no effort says nothing about a gateway's own behavior.
  return entryCapabilities(entry)['reasoning'] === false ? false : undefined
}

/** The output cap one configured model carries: the listing's first, then the catalog's. */
function maxTokensOf(entry: ListingEntry, catalogMaxOutput: number | undefined): number | undefined {
  const capabilities = entryCapabilities(entry)
  const reported = positiveInteger(capabilities['maxOutput'])
    ?? capacity(entry, 'maxOutputTokens', 'max_output_tokens', 'maxTokens', 'max_tokens', 'max_completion_tokens')
    ?? positiveInteger(entryLimit(entry)['output'])
    ?? positiveInteger(entry.top_provider?.max_completion_tokens)
  return reported ?? catalogMaxOutput
}

/**
 * The route-wide reasoning default: a level every reasoning-capable model
 * accepts, since a default one model rejects is a request that model cannot
 * serve. Models that do not reason are not consulted — the level is not sent
 * for them, and a route whose only reasoning models agree is better served by
 * that default than by none.
 * @param levelSets - the levels each reasoning-capable model declared.
 * @returns the common default, or `undefined` when no level is common to all.
 */
export function commonReasoningDefault(levelSets: readonly ReadonlySet<string>[]): ModelThinkingLevel | undefined {
  if (levelSets.length === 0) return undefined
  const common = THINKING_LEVELS.filter(level => levelSets.every(set => set.has(level)))
  return common.find(level => DEFAULT_EFFORT_PREFERENCE.includes(level)) ?? common[0]
}

/**
 * Build one route's model list from its endpoint and the models.dev catalog.
 * @param input - the route, its credential, the catalog, and caller cancellation.
 * @returns the models to store, and the route-wide reasoning default when one exists.
 * @throws LlmError when the route has no readable listing endpoint, when the
 *   endpoint refuses or fails, or when it discloses no usable model.
 */
export async function buildAutoConfiguredRoute(input: AutoConfigureInput): Promise<ConfiguredRoute> {
  const { route } = input
  const baseURL = route.baseURL
  if (baseURL === undefined || baseURL.length === 0) {
    throw new LlmError(
      `route "${route.provider}" configures no baseURL, so it has no endpoint to read models from;`
      + ' a route that serves the installed pi-ai catalog needs no model list',
      'AUTO_CONFIG_UNAVAILABLE',
    )
  }
  const api = route.api ?? 'openai-completions'
  if (!hasReadableListing(api)) {
    throw new LlmError(
      `pi-ai protocol "${api}" has no model listing this build can read, so "${route.provider}" cannot`
      + ' be configured automatically; enter its models by hand on the Models page',
      'AUTO_CONFIG_UNAVAILABLE',
    )
  }
  const apiKey = await input.resolveApiKey()
  const body = await fetchModelListing({
    baseURL,
    api,
    ...apiKey === undefined ? {} : { apiKey },
    ...route.headers === undefined ? {} : { headers: route.headers },
    ...input.signal === undefined ? {} : { signal: input.signal },
  })
  const models: ConfiguredModel[] = []
  const levelSets: Set<string>[] = []
  // How many of the configured models the catalog actually described; the
  // rest exist on the endpoint and nowhere else.
  let enriched = 0
  // A router may repeat an id across a listing's two supported formats; the
  // first spelling wins, so the stored list keeps the endpoint's own order.
  const seen = new Set<string>()
  for (const record of listingRecords(body)) {
    const entry = (record.raw ?? {}) as ListingEntry
    const id = text(entry, 'id') ?? record.key
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    const match = findCatalogModel(input.catalog, id)
    if (match !== undefined) enriched += 1
    const efforts = catalogEfforts(match?.model).efforts
    const reasoningEfforts = reasoningEffortsOf(entry, efforts)
    const contextWindow = contextWindowOf(entry, catalogContext(match?.model))
    const maxTokens = maxTokensOf(entry, catalogMaxTokens(match?.model))
    const owner = ownerLabel(entry)
    const declaredName = displayName(id, entry, input.catalog)
    if (reasoningEfforts !== undefined && reasoningEfforts !== false) {
      levelSets.push(new Set(Object.keys(reasoningEfforts)))
    }
    models.push({
      id,
      name: owner === undefined ? declaredName : `${declaredName} (${owner})`,
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
      input: inputsOf(entry, catalogInputs(match?.model)),
      ...reasoningEfforts === undefined ? {} : { reasoningEfforts },
    })
  }
  if (models.length === 0) {
    throw new LlmError(
      `the listing endpoint of "${route.provider}" disclosed no usable model`,
      'AUTO_CONFIG_EMPTY',
    )
  }
  const reasoning = commonReasoningDefault(levelSets)
  return { models, enriched, ...reasoning === undefined ? {} : { reasoning } }
}
