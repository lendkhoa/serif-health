import { readJson } from '../body'
import { ApiError, ERROR_CODES, badRequest } from '../errors'
import { analyzePlan, type Analysis } from './analyze'
import { loadCodes, matchCodes, type CodeMatch } from './codes'
import { MAX_TEXT, parsePlanInput } from './schema'

export const MAX_PLAN_BYTES = 16 * 1024 // a full plan is about 2 KB

/** POST /api/price-ai/analyze: price a confirmed plan. No LLM. */
export async function analyze(db: D1Database, request: Request): Promise<Analysis> {
  const parsed = parsePlanInput(await readJson(request, MAX_PLAN_BYTES))
  if (!parsed.ok) throw new ApiError(ERROR_CODES.INVALID_PLAN, 400, undefined, parsed.errors)
  return analyzePlan(db, parsed.value)
}

/** GET /api/price-ai/codes?q=: codes to pick from for a procedure named in words. */
export async function codes(db: D1Database, q: URLSearchParams): Promise<{ q: string; codes: CodeMatch[] }> {
  const text = q.get('q')?.trim() ?? ''
  if (!text) throw badRequest(ERROR_CODES.MISSING_QUERY)
  if (text.length > MAX_TEXT) throw badRequest(ERROR_CODES.QUERY_TOO_LONG)
  return { q: text, codes: matchCodes(await loadCodes(db), text) }
}
