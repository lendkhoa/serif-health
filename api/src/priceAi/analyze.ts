import { ApiError, ERROR_CODES } from '../errors'
import { charges } from '../routes'
import { estimate, startingBalances, type Balances } from './estimate'
import { rankBusinesses, type Charge, type RankedBusiness, type Ranking } from './rank'
import type { PlanInput, Procedure } from './schema'

export type Option = RankedBusiness & { member_pays: number; plan_pays: number }

export type ProcedureResult = { procedure: Procedure } & (
  | { status: 'needs_code' } // no usable code; the user has to pick one
  | { status: 'not_found'; code: string } // not in the loaded rate file
  | { status: 'too_many_rates'; code: string } // ranking a subset could miss the cheapest, so none is ranked
  | { status: 'no_match'; code: string; name: string | null } // priced, but not for this place or modifiers
  | ({
      status: 'ranked'
      code: string
      name: string | null
      total_businesses: number
      options: Option[]
    } & Omit<Ranking, 'businesses'>)
)

export type Analysis = {
  starting: Balances
  remaining: Balances // after the cheapest option for every ranked procedure, in the order given
  total_member_pays: number
  results: ProcedureResult[]
}

type Loaded = { status: 'ok'; name: string | null; charges: Charge[] } | { status: 'not_found' | 'too_many_rates' }

export const TOP_OPTIONS = 10
const MAX_PAGES = 4 // bounds D1 queries per request: 2 per page, plus 1 for the first

/** Every rate for a code, or a reason there are none to rank. */
export async function loadCharges(db: D1Database, code: string): Promise<Loaded> {
  const rows: Charge[] = []
  let name: string | null = null
  let cursor: string | null = null
  for (let pages = 0; pages < MAX_PAGES; pages++) {
    const q = new URLSearchParams({ code })
    if (cursor) q.set('cursor', cursor)
    let body: Awaited<ReturnType<typeof charges>>
    try {
      body = await charges(db, q)
    } catch (err) {
      if (err instanceof ApiError && err.code === ERROR_CODES.NOT_FOUND) return { status: 'not_found' }
      throw err
    }
    if (body.item) name = body.item.name
    rows.push(...(body.data as Charge[]))
    cursor = body.next_cursor
    if (!cursor) return { status: 'ok', name, charges: rows }
  }
  return { status: 'too_many_rates' }
}

/** Resolve, rank and price each procedure. Deterministic: no LLM sets a code, a price or an order. */
export async function analyzePlan(db: D1Database, { plan, procedures }: PlanInput): Promise<Analysis> {
  const starting = startingBalances(plan)
  let left = starting
  let total = 0
  const results: ProcedureResult[] = []

  // One at a time: each procedure is priced against what the ones before it used up.
  for (const procedure of procedures) {
    const { code } = procedure
    if (code === null) {
      results.push({ procedure, status: 'needs_code' })
      continue
    }
    const loaded = await loadCharges(db, code)
    if (loaded.status !== 'ok') {
      results.push({ procedure, status: loaded.status, code })
      continue
    }
    const ranking = rankBusinesses(loaded.charges, procedure)
    if (!ranking) {
      results.push({ procedure, status: 'no_match', code, name: loaded.name })
      continue
    }
    const { businesses, ...rest } = ranking
    const before = left
    // Member cost never falls as the rate rises, so rate order is also cost order.
    const options = businesses.slice(0, TOP_OPTIONS).map((b) => {
      const { member_pays, plan_pays } = estimate(b.rate, procedure.copay, plan.coinsurance, before)
      return { ...b, member_pays, plan_pays }
    })
    const cheapest = estimate(businesses[0].rate, procedure.copay, plan.coinsurance, before)
    left = cheapest.after
    total += cheapest.member_pays
    results.push({ procedure, status: 'ranked', code, name: loaded.name, total_businesses: businesses.length, options, ...rest })
  }
  return { starting, remaining: left, total_member_pays: Math.round(total * 100) / 100, results }
}
