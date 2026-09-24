import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { buildAutoConfiguredRoute, commonReasoningDefault } from '../src/auto-config.ts'
import {
  canonicalCatalogProvider, catalogContext, catalogEfforts, catalogInputs, catalogMaxTokens, catalogModelName,
  fetchModelsDevCatalog, findCatalogModel,
} from '../src/models-dev.ts'
import type { CatalogModel, ModelsDevCatalog } from '../src/models-dev.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

/** The catalog as the index holds it, spelled out per test rather than fetched. */
function catalogOf(providers: Record<string, Record<string, CatalogModel>>): ModelsDevCatalog {
  return new Map(Object.entries(providers).map(([id, models]) => [id, new Map(Object.entries(models))]))
}

interface Route {
  status?: number
  body?: string
  /** Written without a declared length, and left open, so a read can be cancelled mid-body. */
  holdOpen?: boolean
  /** Declared length for a body that is not that long, so the read refuses it up front. */
  declaredLength?: number
}

/** A stand-in host answering one scripted reply per path, recording what was asked. */
async function routeServer(routes: Record<string, Route>): Promise<{
  url: string
  paths: string[]
  headers: IncomingMessage['headers'][]
}> {
  const paths: string[] = []
  const headers: IncomingMessage['headers'][] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const path = request.url ?? ''
    paths.push(path)
    headers.push(request.headers)
    const route = routes[path]
    if (route === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    const body = route.body ?? '{}'
    if (route.holdOpen === true) {
      response.writeHead(route.status ?? 200, { 'content-type': 'application/json' })
      response.write(body.slice(0, 1))
      return
    }
    response.writeHead(route.status ?? 200, {
      'content-type': 'application/json',
      'content-length': String(route.declaredLength ?? Buffer.byteLength(body)),
    })
    response.end(body)
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}`, paths, headers }
}

/** One listing reply for the given entries. */
function listing(entries: readonly unknown[]): string {
  return JSON.stringify({ data: entries })
}

/** The route facts one auto-configuration reads, with a baseURL that answers nothing. */
function routeFacts(baseURL: string) {
  return { provider: 'orbit', baseURL, api: 'openai-completions' }
}

/** Build one route against a scripted catalog, defaulting to an empty one. */
async function build(
  baseURL: string,
  catalog: ModelsDevCatalog = catalogOf({}),
  overrides: { api?: string; headers?: Record<string, string>; signal?: AbortSignal } = {},
) {
  return await buildAutoConfiguredRoute({
    route: {
      ...routeFacts(baseURL),
      ...overrides.api === undefined ? {} : { api: overrides.api },
      ...overrides.headers === undefined ? {} : { headers: overrides.headers },
    },
    resolveApiKey: () => Promise.resolve('key-from-storage'),
    catalog,
    ...overrides.signal === undefined ? {} : { signal: overrides.signal },
  })
}

describe('models.dev catalog', () => {
  it('indexes providers and their model records, and skips what is not a record', async () => {
    const server = await routeServer({
      '/catalog.json': {
        body: JSON.stringify({
          openai: { models: { 'gpt-6-astra': { name: 'GPT-6 Astra' }, broken: 5 } },
          half: 'not an object',
          'no-models': {},
        }),
      },
    })

    const catalog = await fetchModelsDevCatalog(`${server.url}/catalog.json`)
    // A provider whose record is not an object is skipped with its models.
    expect([...catalog.keys()]).toEqual(['openai', 'no-models'])
    expect(findCatalogModel(catalog, 'gpt-6-astra')).toMatchObject({ providerId: 'openai', modelId: 'gpt-6-astra' })
    expect(findCatalogModel(catalog, 'broken')).toBeUndefined()
    expect(catalog.get('no-models')?.size).toBe(0)
  })

  it('refuses a catalog that is not a successful JSON object', async () => {
    const broken = await routeServer({ '/catalog.json': { status: 503 } })
    await expect(fetchModelsDevCatalog(`${broken.url}/catalog.json`)).rejects.toThrow(/answered 503/)

    const notJson = await routeServer({ '/catalog.json': { body: 'not json at all' } })
    await expect(fetchModelsDevCatalog(`${notJson.url}/catalog.json`)).rejects.toThrow(/did not answer with JSON/)

    // A reply that is JSON but not an object indexes to nothing rather than throwing.
    const scalar = await routeServer({ '/catalog.json': { body: '5' } })
    await expect(fetchModelsDevCatalog(`${scalar.url}/catalog.json`)).resolves.toEqual(new Map())
  })

  it('reports an unreachable catalog and a cancelled read', async () => {
    await expect(fetchModelsDevCatalog('http://127.0.0.1:1/catalog.json')).rejects.toThrow(/could not reach/)

    const controller = new AbortController()
    const held = await routeServer({ '/catalog.json': { body: '{"openai":{}}', holdOpen: true } })
    const pending = fetchModelsDevCatalog(`${held.url}/catalog.json`, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow(/aborted by caller/)
  })

  it('refuses a reply that declares more than the catalog may hold, with nothing cancelling it', async () => {
    const huge = await routeServer({
      '/catalog.json': { body: '{"openai":{}}', declaredLength: 32 * 1024 * 1024 },
    })
    await expect(fetchModelsDevCatalog(`${huge.url}/catalog.json`))
      .rejects.toThrow(/answered with more than 16777216 bytes/)
  })

  it('cancels a read that is still draining its body when the caller gives up', async () => {
    const controller = new AbortController()
    const held = await routeServer({ '/catalog.json': { body: '{"openai":{}}', holdOpen: true } })
    const pending = fetchModelsDevCatalog(`${held.url}/catalog.json`, controller.signal)
    // Wait until the reply's headers are in and the body read is what is
    // outstanding, so the cancellation lands in the copy loop rather than
    // before the request went out.
    while (held.paths.length === 0) await new Promise(resolve => setTimeout(resolve, 1))
    await new Promise(resolve => setTimeout(resolve, 10))
    controller.abort()
    await expect(pending).rejects.toThrow(/aborted by caller/)
  })

  it('names the catalog provider an unprefixed model id belongs to', () => {
    const cases: readonly (readonly [string, string | undefined])[] = [
      ['gpt-6-astra', 'openai'],
      ['o3-mini', 'openai'],
      ['claude-opus-4-7', 'anthropic'],
      ['gemini-3-pro', 'google'],
      ['gemma-3-27b', 'google'],
      ['glm-5', 'zai'],
      ['deepseek-v4-pro', 'deepseek'],
      ['kimi-k2', 'moonshotai'],
      ['moonshot-v1', 'moonshotai'],
      ['minimax-m2', 'minimax'],
      ['grok-4', 'xai'],
      ['qwen3-max', 'alibaba'],
      ['orbit-large', undefined],
    ]
    for (const [id, provider] of cases) expect(canonicalCatalogProvider(id)).toBe(provider)
  })

  it('asks the providers the id names before it scans the catalog', () => {
    const catalog = catalogOf({
      cx: { 'gpt-6-astra': { name: 'Held under the vendor prefix' } },
      openai: { 'gpt-6-astra': { name: 'Held under the canonical provider' } },
    })

    expect(findCatalogModel(catalog, 'cx/gpt-6-astra')?.model.name).toBe('Held under the vendor prefix')
    // With no such provider, the id's own vendor prefix still names the model.
    expect(findCatalogModel(catalog, 'unlisted/gpt-6-astra')?.providerId).toBe('openai')
  })

  it('ranks a catalog match by what the record declares, then by the id it answered', () => {
    const rich = { reasoning_options: [{ type: 'effort', values: ['low', 'high'] }] }
    const catalog = catalogOf({
      // Neither of these is named by the id, so only the scan can place it.
      bare: { 'model-a': { name: 'Declares nothing' } },
      other: { 'model-a': rich, 'vendor/model-a': rich, 'vendor/model-b': rich },
    })

    // More declarations win over provider order.
    expect(findCatalogModel(catalog, 'vendor/model-a')?.providerId).toBe('other')
    // Rank ties go to the shortest suffix, which is the name the catalog files.
    expect(findCatalogModel(catalogOf({
      a: { 'vendor/model-a': rich },
      b: { 'model-a': rich },
    }), 'vendor/model-a')?.providerId).toBe('b')
    // A remaining tie goes to provider order, so one catalog always answers alike.
    expect(findCatalogModel(catalogOf({
      b: { 'model-a': {} },
      a: { 'model-a': {} },
    }), 'model-a')?.providerId).toBe('a')
    // Nothing matches, and an id with no segments is not a lookup at all.
    expect(findCatalogModel(catalog, 'nowhere-model')).toBeUndefined()
    expect(findCatalogModel(catalog, '  ')).toBeUndefined()

    // A record whose reasoning options are malformed declares no effort at all,
    // so it loses to a record that describes its levels.
    const malformed = { reasoning_options: [5, { type: 'budget', values: ['x'] }, { type: 'effort' }] }
    expect(findCatalogModel(catalogOf({ z: { 'model-a': malformed } }), 'model-a')?.providerId).toBe('z')
  })

  it('reads a record\'s name and capacities, leaving undisclosed ones unset', () => {
    const full = { name: 'Full', limit: { context: 200000, output: 8192 }, modalities: { input: ['text', 'image', 'pdf'] } }
    expect(catalogModelName(full)).toBe('Full')
    expect(catalogContext(full)).toBe(200000)
    expect(catalogMaxTokens(full)).toBe(8192)
    expect(catalogInputs(full)).toEqual(['text', 'image'])

    // An id-only record still names the model; a limit of the wrong type states nothing.
    expect(catalogModelName({ id: 'fallback-id' })).toBe('fallback-id')
    expect(catalogModelName({})).toBeUndefined()
    expect(catalogContext({ limit: { context: 0 } })).toBeUndefined()
    expect(catalogContext({ limit: 'wide' })).toBeUndefined()
    expect(catalogMaxTokens({ limit: { output: -1 } })).toBeUndefined()
    expect(catalogInputs({ modalities: { input: ['text'] } })).toEqual(['text'])
    expect(catalogInputs({ modalities: { input: ['pdf'] } })).toEqual([])
    expect(catalogInputs({ modalities: 'any' })).toEqual([])
    expect(catalogInputs({ modalities: { input: 'text' } })).toEqual([])
    expect(catalogContext(undefined)).toBeUndefined()
    expect(catalogInputs(undefined)).toEqual([])
  })

  it('turns declared effort spellings into the levels this Harness ranks', () => {
    const { efforts, unknown } = catalogEfforts({
      reasoning_options: [
        { type: 'effort', values: ['none', ' none ', 5, ' low ', 'HIGH', 'extra-high', 'x_high', 'turbo', ''] },
        { type: 'budget', values: ['ignored-level'] },
        'not an option',
        { type: 'effort', values: 'not a list' },
      ],
      variants: { medium: {}, low: {} },
    })

    // The wire spelling is kept exactly as declared — trimmed of surrounding
    // space, but otherwise untranslated, because it is what the provider expects
    // to receive.
    expect(efforts).toEqual({
      off: 'none',
      low: 'low',
      high: 'HIGH',
      // Both `extra-high` and `x-high` name the `xhigh` rung, and the last
      // spelling declared is the one the provider is asked for.
      xhigh: 'x_high',
      medium: 'medium',
    })
    // `turbo` is not a level this Harness can offer.
    expect(unknown).toEqual(['turbo'])
    expect(catalogEfforts(undefined)).toEqual({ efforts: {}, unknown: [] })
  })

  it('treats each alias spelling as the level it names', () => {
    for (const [spelling, level] of [
      ['none', 'off'],
      ['disabled', 'off'],
      ['disable', 'off'],
      ['extra-high', 'xhigh'],
      ['extra_highest', 'xhigh'],
      ['x-high', 'xhigh'],
    ] as const) {
      expect(catalogEfforts({ reasoning_options: [{ type: 'effort', values: [spelling] }] }).efforts)
        .toEqual({ [level]: spelling })
    }
  })
})

describe('model auto-configuration', () => {
  it('builds the route from its own listing, named the way the router names the vendor', async () => {
    const server = await routeServer({
      '/models': {
        body: listing([{
          id: 'gpt-6-astra',
          owned_by_name: 'OpenAI on Orbit',
          owned_by: 'openai',
          context_length: 200000,
          max_completion_tokens: 8192,
          capabilities: { vision: true, reasoning: true },
        }]),
      },
    })
    const catalog = catalogOf({
      openai: {
        'gpt-6-astra': {
          name: 'GPT-6 Astra',
          limit: { context: 1000000, output: 128000 },
          modalities: { input: ['text', 'image'] },
          reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
        },
      },
    })

    await expect(build(server.url, catalog)).resolves.toEqual({
      models: [{
        id: 'gpt-6-astra',
        name: 'GPT-6 Astra (OpenAI on Orbit)',
        contextWindow: 200000,
        maxTokens: 8192,
        input: ['text', 'image'],
        reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' },
      }],
      // The catalog described the only model the endpoint served.
      enriched: 1,
      // Every reasoning model on the route offers it, so it can be the route default.
      reasoning: 'medium',
    })
    expect(server.paths).toEqual(['/models'])
  })

  it('counts the models a catalog described apart from the ones only the endpoint could', async () => {
    const server = await routeServer({
      '/models': {
        body: listing([{ id: 'catalogued' }, { id: 'vendor/unknown-1' }, { id: 'vendor/unknown-2' }]),
      },
    })
    const catalog = catalogOf({ openai: { catalogued: { name: 'Catalogued' } } })

    const built = await build(server.url, catalog)
    // The two the catalog never heard of keep the id's own last segment — the
    // router named no vendor for them — and the count says how many were left
    // that way without the caller inspecting any of them.
    expect(built.models.map(model => model.name)).toEqual(['Catalogued', 'unknown-1', 'unknown-2'])
    expect(built.enriched).toBe(1)
  })

  it('sends the stored credential and the route\'s own headers', async () => {
    const server = await routeServer({ '/models': { body: listing([{ id: 'model-a' }]) } })
    await build(server.url, catalogOf({}), { headers: { 'x-tenant': 'acme' } })

    expect(server.headers[0]?.['authorization']).toBe('Bearer key-from-storage')
    expect(server.headers[0]?.['x-tenant']).toBe('acme')
  })

  it('falls back from the vendor name to the id, and names an undocumented model by its last segment', async () => {
    const server = await routeServer({
      '/models': {
        body: listing([
          { id: 'vendor/model-a', owned_by: 'vendor' },
          { id: 'vendor/model-b', name: 'Endpoint Name' },
          { id: 'vendor/model-c', owned_by_name: 'Named Vendor' },
          { id: 'vendor/model-d', name: 'Endpoint Name', owned_by: 'vendor' },
        ]),
      },
    })

    const built = await build(server.url)
    expect(built.models.map(model => model.name)).toEqual([
      'model-a (vendor)',
      // Nothing names a vendor, so the endpoint's own name stands alone.
      'Endpoint Name',
      'model-c (Named Vendor)',
      // The endpoint's own name is better than the id, and still carries the vendor.
      'Endpoint Name (vendor)',
    ])
  })

  it('names a variant id after the base model its suffix points at', async () => {
    const server = await routeServer({
      '/models': {
        body: listing([
          { id: 'vendor/gpt-6-astra-high' },
          { id: 'vendor/gpt-6-astra-thinking' },
          // A suffix whose base the catalog does not describe names nothing.
          { id: 'vendor/ghost-low' },
          { id: '//' },
        ]),
      },
    })
    const catalog = catalogOf({ openai: { 'gpt-6-astra': { name: 'GPT-6 Astra' } } })

    const built = await build(server.url, catalog)
    // The suffix is looked up, then kept as a parenthetical of the base name.
    expect(built.models.map(model => model.name)).toEqual([
      'GPT-6 Astra (High)',
      'GPT-6 Astra (Thinking)',
      'ghost-low',
      // An id that is nothing but separators is preserved rather than invented.
      '//',
    ])
  })

  it('takes the context window from the listing, and from the catalog only where the entry disclaims it', async () => {
    const server = await routeServer({
      '/models': {
        body: listing([
          { id: 'shown', context_window: 32000 },
          { id: 'flagged', context_length: 32000, context_misconfig: true },
          { id: 'flagged-catalogued', context_length: 32000, context_misconfig: true, limit: { context: 64000 } },
          // Flagged with nothing to replace it: the route default answers, not a
          // figure the router itself says is wrong.
          { id: 'flagged-bare', context_length: 32000, context_misconfig: true },
        ]),
      },
    })
    const catalog = catalogOf({
      openai: {
        flagged: { limit: { context: 1000000 } },
        'flagged-catalogued': { limit: { context: 1000000 } },
      },
    })

    const built = await build(server.url, catalog)
    // A flagged entry's own `limit.context` is the listing speaking too, so it
    // is no more trustworthy than the field it contradicts.
    expect(built.models.map(model => model.contextWindow)).toEqual([32000, 1000000, 1000000, undefined])
  })

  it('declares the input modalities the router states, then the catalog, then text alone', async () => {
    const server = await routeServer({
      '/models': {
        body: listing([
          { id: 'blind', capabilities: { vision: false } },
          { id: 'illustrated', capabilities: { vision: true } },
          { id: 'catalogued' },
          { id: 'plain' },
        ]),
      },
    })
    const catalog = catalogOf({ openai: { catalogued: { modalities: { input: ['text', 'image'] } } } })

    const built = await build(server.url, catalog)
    expect(built.models.map(model => model.input)).toEqual([
      ['text'], ['text', 'image'], ['text', 'image'], ['text'],
    ])
  })

  it('stores an effort map, an explicit denial, or nothing at all for each model', async () => {
    const server = await routeServer({
      '/models': {
        body: listing([
          { id: 'thinks' },
          { id: 'denied', capabilities: { reasoning: false } },
          { id: 'quiet' },
          { id: 'off-only' },
        ]),
      },
    })
    const catalog = catalogOf({
      openai: {
        thinks: { reasoning_options: [{ type: 'effort', values: ['off', 'high'] }] },
        'off-only': { reasoning_options: [{ type: 'effort', values: ['none'] }] },
      },
    })

    const built = await build(server.url, catalog)
    expect(built.models.map(model => model.reasoningEfforts)).toEqual([
      { off: 'off', high: 'high' },
      // Only the router may deny reasoning outright.
      false,
      // Nothing declares a level, so the capability stays unstated.
      undefined,
      // A catalog record whose only level is `off` offers nothing to select,
      // and the schema refuses such a map, so the field is left out entirely.
      undefined,
    ])
    expect(built.reasoning).toBe('high')
  })

  it('takes the output cap from the listing before the catalog', async () => {
    const server = await routeServer({
      '/models': {
        body: listing([
          { id: 'capabilities', capabilities: { maxOutput: 4096 } },
          { id: 'snake', max_output_tokens: 2048 },
          { id: 'camel', maxTokens: 1024 },
          { id: 'openai-extension', max_completion_tokens: 512 },
          { id: 'nested', top_provider: { max_completion_tokens: 256 } },
          { id: 'catalogued' },
        ]),
      },
    })
    const catalog = catalogOf({ openai: { catalogued: { limit: { output: 128 } }, camel: { limit: { output: 999 } } } })

    const built = await build(server.url, catalog)
    expect(built.models.map(model => model.maxTokens)).toEqual([4096, 2048, 1024, 512, 256, 128])
  })

  it('reads the enriched models-map format and drops malformed entries', async () => {
    const server = await routeServer({
      '/models': {
        body: JSON.stringify({
          models: {
            'model-a': { name: 'Model A' },
            'model-b': 'not a record',
            scalar: true,
          },
        }),
      },
    })

    const built = await build(server.url)
    expect(built.models).toEqual([{ id: 'model-a', name: 'Model A', input: ['text'] }])
  })

  it('keeps the endpoint order and configures each id once', async () => {
    const server = await routeServer({
      '/models': {
        body: JSON.stringify({
          data: [{ id: 'first' }, { id: 'first' }, { name: 'no id at all' }, null, { id: 'second' }],
        }),
      },
    })

    const built = await build(server.url)
    expect(built.models.map(model => model.id)).toEqual(['first', 'second'])
  })

  it('asks as OpenAI Chat Completions and sends no credential when the route states neither', async () => {
    const server = await routeServer({ '/models': { body: listing([{ id: 'model-a' }]) } })

    const built = await buildAutoConfiguredRoute({
      route: { provider: 'acme', baseURL: server.url },
      resolveApiKey: () => Promise.resolve(undefined),
      catalog: catalogOf({}),
    })

    expect(built.models.map(model => model.id)).toEqual(['model-a'])
    expect(server.headers[0]?.['authorization']).toBeUndefined()
  })

  it('refuses a route with no readable listing, and one whose endpoint disclosed nothing', async () => {
    await expect(build('')).rejects.toThrow(/configures no baseURL/)
    const server = await routeServer({ '/models': { body: listing([]) } })
    await expect(build(server.url, catalogOf({}), { api: 'bedrock' })).rejects.toThrow(/no model listing this build can read/)
    await expect(build(server.url)).rejects.toThrow(/disclosed no usable model/)
    const notAListing = await routeServer({ '/models': { body: JSON.stringify({ unrelated: true }) } })
    await expect(build(notAListing.url)).rejects.toThrow(/neither a "data" array nor a "models" object/)
  })

  it('reports the failure an endpoint answered with', async () => {
    const server = await routeServer({ '/models': { status: 401 } })
    await expect(build(server.url)).rejects.toThrow(/answered 401; check the API key/)
  })

  it('cancels a configuration the caller abandoned', async () => {
    const controller = new AbortController()
    const server = await routeServer({ '/models': { body: listing([{ id: 'model-a' }]), holdOpen: true } })
    const pending = build(server.url, catalogOf({}), { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow(/aborted by caller/)
  })
})

describe('route-wide reasoning default', () => {
  it('needs a level every reasoning model accepts, preferring the middle of the ladder', () => {
    expect(commonReasoningDefault([])).toBeUndefined()
    // Nothing is common to both, so the route states no default.
    expect(commonReasoningDefault([new Set(['low']), new Set(['high'])])).toBeUndefined()
    expect(commonReasoningDefault([new Set(['low', 'high']), new Set(['low', 'max'])])).toBe('low')
    expect(commonReasoningDefault([new Set(['minimal', 'medium'])])).toBe('medium')
    // At the top of the ladder only `max` is left to prefer.
    expect(commonReasoningDefault([new Set(['max', 'xhigh'])])).toBe('max')
  })
})
