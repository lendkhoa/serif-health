import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handle } from '../src/index'
import { complete, providersFrom, status, type LlmEnv } from '../src/priceAi/llm'
import { fakeProvider } from './fakeProvider'

const messages = [{ role: 'user' as const, content: 'secret plan' }]
const schema = { type: 'object' }
let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const vpc = (fetch: (url: string, init: any) => unknown) => ({ fetch: vi.fn(async (u: string, i: any) => fetch(u, i)) }) as any
const reply = (content: unknown, extra = {}) => Response.json({ message: { content }, ...extra })
const ask = (env: LlmEnv) => complete(providersFrom(env), messages, schema)

describe('complete', () => {
  it('uses the first provider that answers', async () => {
    const a = fakeProvider(['{"x":1}'], { name: 'a' })
    const b = fakeProvider([{ x: 2 }], { name: 'b' })
    expect(await complete([a.provider, b.provider], messages, schema)).toEqual({ data: { x: 1 }, provider: 'a' })
    expect(b.calls).toHaveLength(0)
  })
  it.each([['an error', new Error('down')], ['bad JSON', '{'], ['no reply', undefined], ['a hang', 'hang']])(
    'falls back after %s',
    async (_, first) => {
      const a = fakeProvider([first], { timeoutMs: 20 })
      const b = fakeProvider([{ x: 2 }], { name: 'b' })
      expect(await complete([a.provider, b.provider], messages, schema)).toEqual({ data: { x: 2 }, provider: 'b' })
    },
  )
  it('says offline when nothing answers, and bad reply when something did', async () => {
    const down = fakeProvider([new Error('down')]).provider
    const garbled = fakeProvider(['nope']).provider
    for (const list of [[], [down], [down, down]]) {
      await expect(complete(list, messages, schema)).rejects.toMatchObject({ code: 'AI_OFFLINE', status: 503 })
    }
    await expect(complete([garbled, down], messages, schema)).rejects.toMatchObject({ code: 'AI_BAD_REPLY', status: 502 })
  })
})

describe('providers', () => {
  it('sends Ollama the schema and messages', async () => {
    const VPC_SERVICE = vpc(() => reply('{"x":1}'))
    expect(await ask({ VPC_SERVICE, OLLAMA_MODEL: 'm' })).toEqual({ data: { x: 1 }, provider: 'ollama' })
    const [url, init] = VPC_SERVICE.fetch.mock.calls[0]
    expect(url).toBe('http://localhost:11434/api/chat')
    expect(JSON.parse(init.body)).toMatchObject({ model: 'm', messages, format: schema, stream: false })
  })
  it('falls back to Workers AI on an HTTP error or a cut-off reply', async () => {
    for (const bad of [() => new Response('x', { status: 500 }), () => reply('{"x":1}', { done_reason: 'length' })]) {
      const AI = { run: vi.fn(async () => ({ response: { x: 2 } })) } as any
      expect(await ask({ VPC_SERVICE: vpc(bad), AI })).toEqual({ data: { x: 2 }, provider: 'workers-ai' })
      expect(AI.run.mock.calls[0][1]).toMatchObject({ messages, response_format: { type: 'json_schema', json_schema: schema } })
    }
  })
  it('aborts a slow Ollama call', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const VPC_SERVICE = vpc((_u, init) => ((signal = init.signal), new Promise(() => {})))
    const result = expect(ask({ VPC_SERVICE })).rejects.toMatchObject({ code: 'AI_OFFLINE' })
    await vi.advanceTimersByTimeAsync(30_000)
    await result
    expect(signal!.aborted).toBe(true)
  })
  it('does not log the conversation', async () => {
    await expect(ask({ VPC_SERVICE: vpc(() => new Response('secret plan', { status: 500 })) })).rejects.toThrow()
    expect(warn).toHaveBeenCalled()
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret plan')
  })
})

describe('status', () => {
  const check = (fetch: () => unknown) => status({ VPC_SERVICE: vpc(fetch), OLLAMA_MODEL: 'm' })
  it.each([
    ['up', () => Response.json({ models: [{ name: 'm' }] })],
    ['model_missing', () => Response.json({ models: [{ name: 'other' }] })],
    ['bad_response', () => new Response('x', { status: 502 })],
    ['bad_response', () => new Response('<html>')],
    ['unreachable', () => { throw new Error('down') }],
  ])('reports %s', async (expected, fetch) => {
    expect((await check(fetch)).ollama).toBe(expected)
  })
  it('reports a timeout', async () => {
    vi.useFakeTimers()
    const result = check(() => new Promise(() => {}))
    await vi.advanceTimersByTimeAsync(6000)
    expect((await result).ollama).toBe('timeout')
  })
  it('is served by the API, with or without bindings', async () => {
    const res = await handle(new Request('http://x/api/price-ai/status'), { DB: {} as any })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ollama: 'not_configured', latency_ms: null, fallback: false })
  })
})
