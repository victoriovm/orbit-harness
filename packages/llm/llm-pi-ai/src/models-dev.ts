/**
 * Read-only access to the public models.dev catalog for the facts a provider's
 * own listing does not disclose: a model's human-readable name, the reasoning
 * levels it accepts, and the capacities a router may report without owning.
 *
 * A model id a router exposes rarely spells the id the catalog files it under,
 * so lookups walk every suffix of the id — `vendor/family/model` is asked as
 * `vendor/family/model`, then `family/model`, then `model` — and prefer the
 * providers the id itself names before falling back to a scan of the whole
 * catalog. The scan ranks by how much the record actually declares rather than
 * by which provider happened to be listed first, because a gateway id shared
 * by several vendors is more usefully matched to the record that describes
 * reasoning levels.
 *
 * Nothing here is stored and nothing here is authoritative: the catalog fills
 * gaps in a listing, and the caller decides what reaches a profile.
 *
 * @module dsh-llm-pi-ai/models-dev
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { THINKING_LEVELS } from './catalog.ts'
import type { PiAiModality, PiAiReasoningEfforts } from './catalog.ts'
import { DEFAULT_MODELS_DEV_URL } from './config.ts'
import { readBounded } from './discovery.ts'

export { DEFAULT_MODELS_DEV_URL }

/**
 * Ceiling on the catalog reply. The file is a few megabytes and grows with
 * every model released; the bound exists to stop an unexpected response — a
 * mirror serving something else entirely — rather than to size the catalog.
 */
const MAX_CATALOG_BYTES = 16 * 1024 * 1024

/** One provider as the catalog files it. */
interface CatalogProvider {
  models?: unknown
}

/**
 * One model record, as this module reads it. Every field is optional because
 * the catalog's own schema is external and unpublished: a record that carries
 * less than expected leaves the corresponding fact unset rather than failing
 * the lookup.
 */
export interface CatalogModel {
  id?: unknown
  name?: unknown
  reasoning?: unknown
  reasoning_options?: unknown
  variants?: unknown
  modalities?: unknown
  limit?: unknown
}

/** The catalog's model records, indexed by provider id and then by model id. */
export type ModelsDevCatalog = ReadonlyMap<string, ReadonlyMap<string, CatalogModel>>

/** One catalog record located for an endpoint-reported model id. */
export interface CatalogMatch {
  /** Provider the record is filed under. */
  readonly providerId: string
  /** Model id the record is filed under. */
  readonly modelId: string
  /** The record itself. */
  readonly model: CatalogModel
}

/** One record's reasoning levels, as a profile's `reasoningEfforts` spells them. */
export interface CatalogEfforts {
  /** Harness level → wire spelling; empty when the record declares no level. */
  readonly efforts: PiAiReasoningEfforts
  /** Declared spellings no Harness level could name, for the caller's diagnostic. */
  readonly unknown: readonly string[]
}

/**
 * Spelling aliases between the catalog's effort values and the Harness
 * levels. Everything outside this table is compared with punctuation removed,
 * so `extra-high`, `extra_high`, and `extrahigh` all reach `xhigh` without an
 * entry each.
 */
const LEVEL_ALIASES: Readonly<Record<string, string>> = {
  none: 'off',
  disabled: 'off',
  disable: 'off',
  extra_high: 'xhigh',
  extra_highest: 'xhigh',
  x_high: 'xhigh',
}

/** A positive integer field, or `undefined` when absent or unusable. */
function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/** A non-empty string field, or `undefined`. */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Whether a value is a plain JSON object, which every catalog record must be. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Index one parsed catalog reply. Providers and records that are not objects
 * are skipped: a malformed entry costs its own lookup and no other.
 * @param body - the parsed reply.
 * @returns the provider → model index.
 */
function indexCatalog(body: unknown): ModelsDevCatalog {
  const providers = new Map<string, ReadonlyMap<string, CatalogModel>>()
  if (!isRecord(body)) return providers
  for (const [providerId, raw] of Object.entries(body)) {
    if (!isRecord(raw)) continue
    const models = new Map<string, CatalogModel>()
    const listed = (raw as CatalogProvider).models
    if (isRecord(listed)) {
      for (const [modelId, record] of Object.entries(listed)) {
        if (isRecord(record)) models.set(modelId, record)
      }
    }
    providers.set(providerId, models)
  }
  return providers
}

/**
 * Fetch and index the models.dev catalog.
 * @param url - catalog endpoint, from the plugin's own configuration.
 * @param signal - caller cancellation.
 * @returns the provider → model index.
 * @throws LlmError when the catalog is unreachable, refuses, or is not JSON.
 */
export async function fetchModelsDevCatalog(url: string, signal?: AbortSignal): Promise<ModelsDevCatalog> {
  let response: Response
  try {
    const headers = new Headers(Object.entries(attributionHeaders()))
    headers.set('accept', 'application/json')
    response = await fetch(url, { method: 'GET', headers, ...signal === undefined ? {} : { signal } })
  } catch (error: unknown) {
    if (signal?.aborted) {
      throw new LlmError('models.dev catalog read aborted by caller', 'ABORTED', { cause: error })
    }
    throw new LlmError(`could not reach ${url}`, 'CATALOG_FAILED', { cause: error })
  }
  if (!response.ok) {
    throw new LlmError(`${url} answered ${response.status}`, 'CATALOG_FAILED')
  }
  let text: string
  try {
    text = await readBounded(response, url, MAX_CATALOG_BYTES)
  } catch (error: unknown) {
    if (signal?.aborted) {
      throw new LlmError('models.dev catalog read aborted by caller', 'ABORTED', { cause: error })
    }
    throw error
  }
  try {
    return indexCatalog(JSON.parse(text))
  } catch (error: unknown) {
    throw new LlmError(`${url} did not answer with JSON`, 'CATALOG_FAILED', { cause: error })
  }
}

/** One id's path segments, without the router's `:free` variant marker. */
function idSegments(rawId: string): string[] {
  return rawId.trim().replace(/:free$/i, '').split('/').map(part => part.trim()).filter(Boolean)
}

/** The last segment of one non-empty id list: the bare model name. */
function bareName(segments: readonly string[]): string {
  // Non-empty by construction: every caller returns early on an empty list.
  return segments[segments.length - 1] as string
}

/**
 * Every suffix of one id, the bare model name first: `a/b/c` is asked as `c`,
 * then `b/c`, then the whole id. The catalog files models under their own
 * names, so the shortest suffix is the likeliest match and the longest is the
 * last resort — which is also the order `findCatalogModel` prefers on a tie.
 */
function idCandidates(segments: readonly string[]): string[] {
  const candidates: string[] = []
  for (let index = segments.length - 1; index >= 0; index--) {
    // Suffixes of different lengths cannot join to the same id: segments hold
    // no separator themselves, and the empty ones were filtered out above.
    candidates.push(segments.slice(index).join('/'))
  }
  return candidates
}

/**
 * Providers the id itself points at, nearest first: every segment but the last,
 * reversed, so `vendor/family/model` asks `family` before `vendor`.
 */
function idProviderHints(segments: readonly string[]): string[] {
  const hints = segments.slice(0, -1).reverse()
  return hints.filter((hint, index) => hints.indexOf(hint) === index)
}

/**
 * The catalog provider an unprefixed id most likely belongs to, from the
 * conventions every vendor follows in its own model names. Absent means the id
 * names no recognizable vendor and only the catalog scan can place it.
 * @param modelId - the model id to classify.
 * @returns the catalog provider id, or `undefined`.
 */
export function canonicalCatalogProvider(modelId: string): string | undefined {
  const id = modelId.toLowerCase()
  if (/^(gpt-|o1|o3|o4)/.test(id)) return 'openai'
  if (/^claude/.test(id)) return 'anthropic'
  if (/^(gemini|gemma)/.test(id)) return 'google'
  if (/^glm/.test(id)) return 'zai'
  if (/^deepseek/.test(id)) return 'deepseek'
  if (/^(kimi|moonshot)/.test(id)) return 'moonshotai'
  if (/^minimax/.test(id)) return 'minimax'
  if (/^grok/.test(id)) return 'xai'
  if (/^qwen/.test(id)) return 'alibaba'
  return undefined
}

/** How much a candidate record declares; a richer record identifies the model better. */
function declaredEffortCount(model: CatalogModel): number {
  const levels = model.reasoning_options
  if (!Array.isArray(levels)) return 0
  let total = 0
  for (const option of levels) {
    if (!isRecord(option) || option['type'] !== 'effort' || !Array.isArray(option['values'])) continue
    total += option['values'].length
  }
  return total
}

/**
 * Locate the catalog record for one endpoint-reported model id, trying the id's
 * own suffixes against the providers it names and then against the whole
 * catalog.
 * @param catalog - the indexed catalog.
 * @param rawId - the id exactly as the endpoint reported it.
 * @returns the record and its place in the catalog, or `undefined` when nothing matches.
 */
export function findCatalogModel(catalog: ModelsDevCatalog, rawId: string): CatalogMatch | undefined {
  const segments = idSegments(rawId)
  if (segments.length === 0) return undefined
  const candidates = idCandidates(segments)
  const canonical = canonicalCatalogProvider(bareName(segments))
  const preferred = [
    ...idProviderHints(segments),
    ...canonical === undefined ? [] : [canonical],
  ]
  for (const providerId of preferred) {
    const models = catalog.get(providerId)
    if (models === undefined) continue
    for (const candidate of candidates) {
      const model = models.get(candidate)
      if (model !== undefined) return { providerId, modelId: candidate, model }
    }
  }
  const matches: (CatalogMatch & { readonly rank: number; readonly depth: number })[] = []
  for (const [providerId, models] of catalog) {
    for (const [depth, candidate] of candidates.entries()) {
      const model = models.get(candidate)
      if (model === undefined) continue
      matches.push({ providerId, modelId: candidate, model, rank: declaredEffortCount(model), depth })
    }
  }
  // A record that declares more efforts wins; ties go to the id's own shortest
  // suffix, then to provider order so the same catalog always answers alike.
  matches.sort((left, right) =>
    (right.rank - left.rank) || (left.depth - right.depth) || left.providerId.localeCompare(right.providerId))
  const best = matches[0]
  return best === undefined ? undefined : { providerId: best.providerId, modelId: best.modelId, model: best.model }
}

/**
 * The name a record carries, preferring its own over the id it is filed under.
 * @param model - the record, when one matched.
 * @returns the name, or `undefined` when the record declares neither.
 */
export function catalogModelName(model: CatalogModel | undefined): string | undefined {
  return nonEmptyString(model?.name) ?? nonEmptyString(model?.id)
}

/**
 * The context capacity a record declares.
 * @param model - the record, when one matched.
 * @returns the declared context window, or `undefined` when none is usable.
 */
export function catalogContext(model: CatalogModel | undefined): number | undefined {
  const limit = model?.limit
  return isRecord(limit) ? positiveInteger(limit['context']) : undefined
}

/**
 * The output capability a record declares.
 * @param model - the record, when one matched.
 * @returns the declared output cap, or `undefined` when none is usable.
 */
export function catalogMaxTokens(model: CatalogModel | undefined): number | undefined {
  const limit = model?.limit
  return isRecord(limit) ? positiveInteger(limit['output']) : undefined
}

/**
 * The request modalities a record declares, narrowed to the ones a profile may
 * carry. Catalog vocabularies name attachment kinds this Harness has no
 * request field for (`pdf` among them), and those are dropped rather than
 * mapped onto a modality they are not.
 * @param model - the record, when one matched.
 * @returns the declared modalities in `MODALITIES` order, empty when none apply.
 */
export function catalogInputs(model: CatalogModel | undefined): PiAiModality[] {
  const modalities = model?.modalities
  if (!isRecord(modalities)) return []
  const input = modalities['input']
  if (!Array.isArray(input)) return []
  return input.includes('image') ? ['text', 'image'] : input.includes('text') ? ['text'] : []
}

/**
 * Translate one catalog effort spelling onto its Harness level.
 * @param raw - the spelling exactly as the catalog wrote it.
 * @returns the level, or `undefined` when no level can name it.
 */
function harnessLevel(raw: string): string | undefined {
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_')
  const alias = LEVEL_ALIASES[normalized] ?? normalized.replace(/_/g, '')
  return THINKING_LEVELS.some(level => level === alias) ? alias : undefined
}

/**
 * The reasoning levels one record declares, keyed by Harness level and valued
 * with the spelling to send. Both of the catalog's effort vocabularies are
 * read: an `effort` reasoning option, and the variant keys a router publishes
 * as separately selectable model ids.
 * @param model - the record, when one matched.
 * @returns the level map and the spellings no level could name.
 */
export function catalogEfforts(model: CatalogModel | undefined): CatalogEfforts {
  const declared: string[] = []
  const options = model?.reasoning_options
  if (Array.isArray(options)) {
    for (const option of options) {
      if (!isRecord(option) || option['type'] !== 'effort' || !Array.isArray(option['values'])) continue
      for (const value of option['values']) {
        const spelling = nonEmptyString(value)?.trim()
        if (spelling !== undefined && !declared.includes(spelling)) declared.push(spelling)
      }
    }
  }
  const variants = model?.variants
  if (isRecord(variants)) {
    for (const key of Object.keys(variants)) {
      if (!declared.includes(key)) declared.push(key)
    }
  }
  const efforts: Record<string, string> = {}
  const unknown: string[] = []
  for (const spelling of declared) {
    const level = harnessLevel(spelling)
    if (level === undefined) {
      unknown.push(spelling)
      continue
    }
    // The wire spelling is kept exactly as the catalog wrote it: it is what the
    // provider expects to receive, not a level name to be translated again.
    efforts[level] = spelling
  }
  return { efforts, unknown }
}
