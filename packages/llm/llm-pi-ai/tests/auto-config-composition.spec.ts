/**
 * The auto-configuration action inside a real composition: the namespace owner
 * reads the route's endpoint with the credential the credential seam stores and
 * writes the result into the settings document it owns.
 */
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'

const NS = 'llm-pi-ai'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
  vi.unstubAllEnvs()
})

interface Host {
  url: string
  paths: string[]
  headers: IncomingMessage['headers'][]
}

/**
 * A gateway answering its own model listing and a models.dev catalog, so the
 * whole action runs against real HTTP rather than a stubbed fetch.
 */
async function gateway(): Promise<Host> {
  const paths: string[] = []
  const headers: IncomingMessage['headers'][] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const path = request.url ?? ''
    paths.push(path)
    headers.push(request.headers)
    const body = path === '/models'
      ? JSON.stringify({
        data: [
          {
            id: 'gpt-6-astra',
            owned_by_name: 'cx',
            context_length: 400000,
            capabilities: { vision: true, reasoning: true },
          },
          { id: 'cx/review-4', owned_by: 'cx' },
        ],
      })
      : path === '/catalog.json'
        ? JSON.stringify({
          // The catalog's own shape: providers keyed by id, each with its models.
          openai: {
            models: {
              'gpt-6-astra': {
                name: 'GPT-6 Astra',
                modalities: { input: ['text', 'image'] },
                reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
              },
            },
          },
          cx: {
            models: { 'review-4': { name: 'Review 4', reasoning_options: [{ type: 'effort', values: ['low', 'high'] }] } },
          },
        })
        : undefined
    if (body === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) })
    response.end(body)
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}`, paths, headers }
}

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

/** Boot the plugin over a live Loader-backed config and a real credential store. */
async function boot(config: LlmPiAi.Options): Promise<{ ctx: Context; dir: string; stored: () => LlmPiAi.Options }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pi-autoconfig-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  // A fake settings seam: the pi-ai plugin only needs `mutate` to persist the
  // rebuilt model list, so the test records what would reach the document and
  // applies it back through a Loader config update (the real write path).
  const live = await liveConfig(ctx, LlmPiAi, config as unknown as Record<string, unknown>)
  const writes: Array<{ path: readonly (string | number)[]; value: unknown }> = []
  ctx.provide('settings', {
    mutate: async (_ns: string, ops: readonly { op: string; path: readonly (string | number)[]; value?: unknown }[]) => {
      for (const op of ops) {
        if (op.op === 'set') writes.push({ path: op.path, value: op.value })
      }
      const patch: Record<string, unknown> = {}
      for (const write of writes) {
        if (write.path[0] === 'providers' && typeof write.path[1] === 'string') {
          const route = write.path[1]
          const rest = write.path.slice(2)
          const providers = ((patch.providers ?? {}) as Record<string, unknown>)
          const slot = (providers[route] ?? {}) as Record<string, unknown>
          providers[route] = slot
          patch.providers = providers
          let cursor = slot
          for (let index = 0; index < rest.length - 1; index += 1) {
            const key = String(rest[index])
            cursor[key] = (cursor[key] ?? {}) as Record<string, unknown>
            cursor = cursor[key] as Record<string, unknown>
          }
          cursor[String(rest[rest.length - 1])] = write.value
        }
      }
      await live.update(patch)
    },
  } as never)
  return { ctx, dir, stored: () => live.entry.options.config as unknown as LlmPiAi.Options }
}

describe('provider auto-configuration in a composition', () => {
  it('replaces a route\'s model list from its endpoint and stores it', async () => {
    const gatewayHost = await gateway()
    const { ctx, stored } = await boot({
      modelsDevUrl: `${gatewayHost.url}/catalog.json`,
      providers: {
        acme: {
          api: 'openai-completions',
          baseURL: gatewayHost.url,
          apiKeyEnv: 'ACME_KEY',
          // The stale list the action exists to replace.
          models: [{ id: 'retired-model', name: 'Retired' }],
        },
      },
    })
    await ctx.credentials.set(credentialRef('ACME_KEY'), 'gateway-secret')

    await expect(ctx.llm.autoConfigureModels(NS, { provider: 'acme' }))
      .resolves.toEqual({ provider: 'acme', models: 2, enriched: 2 })
    // The catalog is public; the route's own listing carries the stored credential.
    expect(gatewayHost.paths).toEqual(['/catalog.json', '/models'])
    expect(gatewayHost.headers[1]?.authorization).toBe('Bearer gateway-secret')

    // The stored document is what the route now serves: names and reasoning
    // levels come from the catalog, the context window from the router, and
    // the reasonings common to both models become the route default.
    expect(JSON.stringify(stored().providers)).toContain('high')
    expect((await ctx.llm.listModels('acme')).map(model => model.id)).toEqual(['gpt-6-astra', 'cx/review-4'])
    const resolved = await ctx.llm.resolveModelInfo('acme', 'gpt-6-astra')
    expect(resolved).toMatchObject({ name: 'GPT-6 Astra (cx)', context: { contextWindow: 400000 } })
    expect(resolved.reasoning?.efforts.map(effort => effort.id)).toEqual(['low', 'medium', 'high'])
    expect(resolved.reasoning?.defaultEffort).toBe('high')
    // The review model kept the vendor prefix in its name: the router names no
    // vendor for it, so its id's own prefix answers.
    expect((await ctx.llm.resolveModelInfo('acme', 'cx/review-4')).name).toBe('Review 4 (cx)')
  })

  it('advertises the action on the routes it can rebuild, and only those', async () => {
    const gatewayHost = await gateway()
    const { ctx } = await boot({
      modelsDevUrl: `${gatewayHost.url}/catalog.json`,
      providers: {
        acme: {
          api: 'openai-completions',
          baseURL: gatewayHost.url,
          models: [{ id: 'retired-model', name: 'Retired' }],
        },
        // A route the catalog describes: its models come from pi-ai, so there
        // is no listing to rebuild them from.
        deepseek: {},
      },
    })

    const entries = ctx.llm.listConfigurableProviders()
    expect(entries.find(entry => entry.provider === 'acme')?.autoConfigurable).toBe(true)
    expect(entries.find(entry => entry.provider === 'deepseek')?.autoConfigurable).toBeUndefined()
  })

  it('reads the published catalog when the deployment names none, with the route\'s own headers', async () => {
    const gatewayHost = await gateway()
    // A deployment that configures no catalog URL reads the published one; the
    // reply here stands in for it so the test needs no network.
    const network = globalThis.fetch
    const published: string[] = []
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url
      published.push(url)
      return url.startsWith('https://models.dev/')
        ? Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
        : network(input, init)
    })
    const { ctx } = await boot({
      providers: {
        // A route the installed catalog describes, pointed at this gateway: it
        // names no protocol of its own, so each model's catalog entry answers
        // for the request while the listing is read as OpenAI Chat Completions.
        deepseek: {
          baseURL: gatewayHost.url,
          headers: { 'x-tenant': 'acme' },
          models: [{ id: 'deepseek-v4-flash' }],
        },
      },
    })

    const controller = new AbortController()
    await expect(ctx.llm.autoConfigureModels(NS, { provider: 'deepseek' }, controller.signal))
      // The stubbed catalog is empty, so every model came from the listing.
      .resolves.toEqual({ provider: 'deepseek', models: 2, enriched: 0 })
    expect(published[0]).toBe('https://models.dev/api.json')
    // The route names no credential, so the listing is asked unauthenticated
    // and carries the deployment headers the profile configured.
    expect(gatewayHost.paths).toEqual(['/models'])
    expect(gatewayHost.headers[0]?.['x-tenant']).toBe('acme')
    expect(gatewayHost.headers[0]?.authorization).toBeUndefined()
  })

  it('refuses a route whose profile has no endpoint to read', async () => {
    const gatewayHost = await gateway()
    const { ctx } = await boot({
      modelsDevUrl: `${gatewayHost.url}/catalog.json`,
      // A route the installed catalog serves: its models come from pi-ai, so
      // there is no endpoint of its own to interrogate.
      providers: { deepseek: {} },
    })

    await expect(ctx.llm.autoConfigureModels(NS, { provider: 'deepseek' }))
      .rejects.toThrow(/configures no baseURL/)
  })

  it('refuses a route nothing registered, and reports an endpoint that refused', async () => {
    const gatewayHost = await gateway()
    const { ctx } = await boot({
      modelsDevUrl: `${gatewayHost.url}/catalog.json`,
      providers: {
        acme: {
          api: 'openai-completions',
          baseURL: `${gatewayHost.url}/gone`,
          models: [{ id: 'retired-model', name: 'Retired' }],
        },
      },
    })

    await expect(ctx.llm.autoConfigureModels(NS, { provider: 'absent' }))
      .rejects.toThrow(/is not registered/)

    // The endpoint's own refusal reaches the caller with its status, and
    // nothing was stored: the profile keeps the models it had.
    await expect(ctx.llm.autoConfigureModels(NS, { provider: 'acme' }))
      .rejects.toThrow(/answered 404/)
    expect((await ctx.llm.listModels('acme')).map(model => model.id)).toEqual(['retired-model'])
  })
})
