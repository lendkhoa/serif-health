import { ERROR_CODES, ApiError, errorResponse } from './errors'
import { status, type LlmEnv } from './priceAi/llm'
import * as priceAi from './priceAi/routes'
import * as routes from './routes'

export interface Env extends LlmEnv {
  DB: D1Database
}

type Handler = (env: Env, params: string[], query: URLSearchParams, request: Request) => Promise<unknown>
type Method = 'GET' | 'POST'

const ROUTES: [Method, RegExp, Handler][] = [
  ['GET', /^\/api\/health$/, async () => ({ ok: true })],
  ['GET', /^\/api\/search$/, (e, _p, q) => routes.search(e.DB, q)],
  ['GET', /^\/api\/rates$/, (e, _p, q) => routes.rates(e.DB, q)],
  ['GET', /^\/api\/charges$/, (e, _p, q) => routes.charges(e.DB, q)],
  ['GET', /^\/api\/business$/, (e, _p, q) => routes.business(e.DB, q)],
  ['GET', /^\/api\/summary$/, (e, _p, q) => routes.summary(e.DB, q)],
  ['GET', /^\/api\/suggest$/, (e, _p, q) => routes.suggest(e.DB, q)],
  ['GET', /^\/api\/providers$/, (e, _p, q) => routes.providers(e.DB, q)],
  ['GET', /^\/api\/codes\/([^/]+)$/, (e, [code]) => routes.codeDetail(e.DB, code)],
  ['GET', /^\/api\/org\/([^/]+)$/, (e, [ein], q) => routes.org(e.DB, ein, q)],
  ['GET', /^\/api\/provider\/([^/]+)$/, (e, [npi], q) => routes.provider(e.DB, npi, q)],
  ['GET', /^\/api\/price-ai\/codes$/, (e, _p, q) => priceAi.codes(e.DB, q)],
  ['GET', /^\/api\/price-ai\/status$/, (e) => status(e)],
  ['POST', /^\/api\/price-ai\/analyze$/, (e, _p, _q, request) => priceAi.analyze(e.DB, request)],
]

export async function handle(request: Request, env: Env): Promise<Response> {
  try {
    const method = request.method === 'HEAD' ? 'GET' : request.method
    const url = new URL(request.url)
    let pathExists = false
    for (const [allowed, pattern, handler] of ROUTES) {
      const match = pattern.exec(url.pathname)
      if (match) {
        pathExists = true
        if (method !== allowed) continue
        const params = match.slice(1).map(decodeURIComponent)
        const body = await handler(env, params, url.searchParams, request)
        // Nothing can invalidate browser caches on re-ingest; the UI keeps its own per-session page cache.
        return Response.json(body, { headers: { 'Cache-Control': 'no-store' } })
      }
    }
    if (pathExists) throw new ApiError(ERROR_CODES.METHOD_NOT_ALLOWED, 405)
    throw new ApiError(ERROR_CODES.ROUTE_NOT_FOUND, 404)
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err)
    console.error(err)
    return errorResponse(new ApiError(ERROR_CODES.INTERNAL, 500))
  }
}

export default {
  fetch: handle,
} satisfies ExportedHandler<Env>
