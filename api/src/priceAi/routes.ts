import { readJson } from '../body'
import { ApiError, ERROR_CODES, badRequest } from '../errors'
import { analyzePlan, type Analysis } from './analyze'
import { explain as explainResult, type Explanation } from './explain'
import { providersFrom, type LlmEnv } from './llm'
import { parseEmployerMessage, type EmployerInput } from './employer'
import { recommendProviders, type Recommendation } from './recommend'
import { loadCodes, matchCodes, type CodeMatch } from './codes'
import { MAX_TEXT, isObject, parsePlanInput } from './schema'

export const MAX_PLAN_BYTES = 16 * 1024 // a full plan is about 2 KB

/** POST /api/price-ai/analyze: price a confirmed plan. No LLM. */
export async function analyze(db: D1Database, request: Request): Promise<Analysis> {
  const parsed = parsePlanInput(await readJson(request, MAX_PLAN_BYTES))
  if (!parsed.ok) throw new ApiError(ERROR_CODES.INVALID_PLAN, 400, undefined, parsed.errors)
  return analyzePlan(db, parsed.value)
}

async function employerInput(request: Request): Promise<EmployerInput> {
  const body = await readJson(request, MAX_PLAN_BYTES)
  const parsed = parseEmployerMessage(isObject(body) ? body.message : undefined)
  if (parsed.ok) return parsed.value
  if (parsed.errors === null) throw badRequest(ERROR_CODES.MISSING_CONTEXT)
  throw new ApiError(ERROR_CODES.INVALID_PLAN, 400, undefined, parsed.errors)
}

/** POST /api/price-ai/recommend: providers an employer should steer to. No LLM. */
export async function recommend(db: D1Database, request: Request): Promise<Recommendation> {
  return recommendProviders(db, await employerInput(request))
}

/** POST /api/price-ai/explain: a summary of the same message's results, recomputed here so none come from the client. */
export async function explain(env: LlmEnv & { DB: D1Database }, request: Request): Promise<Explanation> {
  const input = await employerInput(request)
  return explainResult(providersFrom(env), await recommendProviders(env.DB, input))
}

/** GET /api/price-ai/codes?q=: codes to pick from for a procedure named in words. */
export async function codes(db: D1Database, q: URLSearchParams): Promise<{ q: string; codes: CodeMatch[] }> {
  const text = q.get('q')?.trim() ?? ''
  if (!text) throw badRequest(ERROR_CODES.MISSING_QUERY)
  if (text.length > MAX_TEXT) throw badRequest(ERROR_CODES.QUERY_TOO_LONG)
  return { q: text, codes: matchCodes(await loadCodes(db), text) }
}
