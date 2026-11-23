import { ERROR_CODES, ApiError, errorResponse } from './errors'
import * as routes from './routes'

export interface Env {
  DB: D1Database
}

type Handler = (env: Env, params: string[], query: URLSearchParams) => Promise<unknown>

const ROUTES: [RegExp, Handler][] = [
  [/^\/api\/health$/, async () => ({ ok: true })],
  [/^\/api\/search$/, (e, _p, q) => routes.search(e.DB, q)],
  [/^\/api\/summary$/, (e, _p, q) => routes.summary(e.DB, q)],
  [/^\/api\/suggest$/, (e, _p, q) => routes.suggest(e.DB, q)],
  [/^\/api\/providers$/, (e, _p, q) => routes.providers(e.DB, q)],
  [/^\/api\/codes\/([^/]+)$/, (e, [code]) => routes.codeDetail(e.DB, code)],
  [/^\/api\/org\/([^/]+)$/, (e, [ein], q) => routes.org(e.DB, ein, q)],
  [/^\/api\/provider\/([^/]+)$/, (e, [npi], q) => routes.provider(e.DB, npi, q)],
]

export async function handle(request: Request, env: Env): Promise<Response> {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      throw new ApiError(ERROR_CODES.METHOD_NOT_ALLOWED, 405)
    }
    const url = new URL(request.url)
    for (const [pattern, handler] of ROUTES) {
      const match = pattern.exec(url.pathname)
      if (match) {
        const params = match.slice(1).map(decodeURIComponent)
        const body = await handler(env, params, url.searchParams)
        // Rates only change on re-ingest, so let browsers reuse pages instead of re-querying D1.
        const cacheable = url.pathname !== '/api/health'
        return Response.json(body, { headers: { 'Cache-Control': cacheable ? 'public, max-age=300' : 'no-store' } })
      }
    }
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
