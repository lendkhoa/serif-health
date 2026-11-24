import { ApiError, ERROR_CODES } from '../errors'

export type Message = { role: 'system' | 'user' | 'assistant'; content: string }
export type JsonSchema = Record<string, unknown>

/** One model host. Throws on any failure; must stop when `signal` aborts. */
export type Provider = {
  name: string
  timeoutMs: number
  /** Returns the model's reply as JSON text, or already parsed. */
  complete(messages: Message[], schema: JsonSchema, signal: AbortSignal): Promise<unknown>
}

/** `data` is JSON but still untrusted: the schema only guides the model, so validate it. */
export type Completion = { data: unknown; provider: string }

export type LlmEnv = { VPC_SERVICE?: Fetcher; AI?: Ai; OLLAMA_MODEL?: string }

const OLLAMA_TIMEOUT_MS = 25_000 // leaves room to load the model
const WORKERS_AI_TIMEOUT_MS = 15_000
const STATUS_TIMEOUT_MS = 5_000
const MAX_TOKENS = 2048
const OLLAMA_URL = 'http://localhost:11434' // resolved at the far end of the tunnel
const DEFAULT_OLLAMA_MODEL = 'gemma3:4b'
const WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

const ollamaModel = (env: LlmEnv) => env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL

/** The host answered, but not with usable JSON. */
class BadReply extends Error {}

const ollama = (vpc: Fetcher, model: string): Provider => ({
  name: 'ollama',
  timeoutMs: OLLAMA_TIMEOUT_MS,
  async complete(messages, schema, signal) {
    const res = await vpc.fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        format: schema,
        stream: false,
        keep_alive: '30m',
        options: { temperature: 0, num_ctx: 8192, num_predict: MAX_TOKENS },
      }),
      signal,
    })
    if (!res.ok) {
      await res.body?.cancel()
      throw new Error(`HTTP ${res.status}`)
    }
    const body = (await res.json()) as { message?: { content?: unknown }; done_reason?: string }
    if (body.done_reason === 'length') throw new BadReply('reply was cut off')
    return body.message?.content
  },
})

const workersAi = (ai: Ai): Provider => ({
  name: 'workers-ai',
  timeoutMs: WORKERS_AI_TIMEOUT_MS,
  async complete(messages, schema, signal) {
    const body = (await ai.run(
      WORKERS_AI_MODEL,
      { messages, response_format: { type: 'json_schema', json_schema: schema }, max_tokens: MAX_TOKENS, temperature: 0 },
      { signal },
    )) as { response?: unknown }
    return body.response
  },
})

/** Ollama first, then Workers AI. A missing binding is skipped. */
export function providersFrom(env: LlmEnv): Provider[] {
  return [
    ...(env.VPC_SERVICE ? [ollama(env.VPC_SERVICE, ollamaModel(env))] : []),
    ...(env.AI ? [workersAi(env.AI)] : []),
  ]
}

function parseReply(reply: unknown): unknown {
  if (typeof reply === 'object' && reply !== null) return reply
  if (typeof reply !== 'string') throw new BadReply('reply was empty')
  try {
    return JSON.parse(reply)
  } catch {
    throw new BadReply('reply was not JSON')
  }
}

/** Runs `work` with a deadline that holds even if `work` ignores its signal. */
async function withTimeout<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new DOMException('timed out', 'TimeoutError')
      reject(err)
      controller.abort(err)
    }, ms)
  })
  try {
    return await Promise.race([work(controller.signal), deadline])
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

/** Asks each provider in turn. AI_OFFLINE if none answered, AI_BAD_REPLY if one did but not with JSON. */
export async function complete(providers: Provider[], messages: Message[], schema: JsonSchema): Promise<Completion> {
  let badReply = false
  for (const provider of providers) {
    try {
      const reply = await withTimeout(provider.timeoutMs, (signal) => provider.complete(messages, schema, signal))
      return { data: parseReply(reply), provider: provider.name }
    } catch (err) {
      if (err instanceof BadReply) badReply = true
      // Message only: a full error could carry the user's plan into the logs.
      console.warn(`LLM ${provider.name} failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown error'}`)
    }
  }
  if (badReply) throw new ApiError(ERROR_CODES.AI_BAD_REPLY, 502)
  throw new ApiError(ERROR_CODES.AI_OFFLINE, 503)
}

export type OllamaStatus = 'up' | 'model_missing' | 'bad_response' | 'timeout' | 'unreachable' | 'not_configured'
export type Status = { ollama: OllamaStatus; model: string; latency_ms: number | null; fallback: boolean }

/** Lists Ollama's models through the tunnel. Cheap: it does not load or run one. */
export async function status(env: LlmEnv): Promise<Status> {
  const model = ollamaModel(env)
  const result = (ollama: OllamaStatus, latency_ms: number | null): Status => ({ ollama, model, latency_ms, fallback: !!env.AI })
  const vpc = env.VPC_SERVICE
  if (!vpc) return result('not_configured', null)
  const started = Date.now()
  try {
    const state = await withTimeout(STATUS_TIMEOUT_MS, async (signal): Promise<OllamaStatus> => {
      const res = await vpc.fetch(`${OLLAMA_URL}/api/tags`, { signal })
      if (!res.ok) {
        await res.body?.cancel()
        console.warn(`Ollama status: HTTP ${res.status}`)
        return 'bad_response'
      }
      const body = (await res.json().catch(() => null)) as { models?: { name?: string }[] } | null
      if (!Array.isArray(body?.models)) return 'bad_response'
      return body.models.some((m) => m?.name === model) ? 'up' : 'model_missing'
    })
    return result(state, Date.now() - started)
  } catch (err) {
    console.warn(`Ollama status failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown error'}`)
    return result(err instanceof DOMException && err.name === 'TimeoutError' ? 'timeout' : 'unreachable', null)
  }
}
