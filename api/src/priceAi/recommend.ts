import { loadCharges, type RateSpread } from './analyze'
import type { Constraints, EmployerInput, EmployerProcedure } from './employer'
import { estimate, startingBalances, type Balances } from './estimate'
import { medianOf, rankBusinesses, type RankedBusiness, type Ranking, type Variant } from './rank'
import type { Plan } from './schema'

export type Pick = {
  provider: string
  rate: number
  annual_spend: number
  median_spend: number
  savings: number
  /** Other businesses priced the same or within the tie tolerance, cheapest first. */
  alternatives: { total: number; names: string[] }
}

export type ProcedureOutcome = {
  code: string | null
  description: string
  annual_volume: number
  status: 'recommended' | 'excluded'
  /** Why it is excluded. */
  reason: 'no_code' | 'not_found' | 'too_many_rates' | 'no_match' | 'too_few_businesses' | 'no_feasible_shortlist' | null
  businesses: number
  rates: RateSpread | null
  variant: Variant | null
  other_variants: number // more than 0 means the variant was assumed
  pick: Pick | null
}

/** What employees save per year, if every visit falls at this point in a member's year. The employer saves the rest. */
export type Split = { scenario: 'deductible_not_met' | 'deductible_met' | 'out_of_pocket_met'; employer: number; employees: number }

export type Totals = {
  recommended_spend: number
  median_spend: number
  savings: number
  savings_percent: number
  savings_per_employee: number | null
  lowest_spend: number // with as many providers as allowed
  split: Split[]
}

export type Recommendation = {
  status: 'recommended' | 'coverage_not_met' | 'no_feasible_shortlist'
  constraints: Constraints
  coverage: { qualifying: number; total: number; share: number; met: boolean }
  providers: { name: string; eins: string[]; codes: string[]; annual_spend: number; needs_review: boolean }[]
  totals: Totals | null
  procedures: ProcedureOutcome[]
}

type Candidate = { name: string; eins: string[]; rates: (number | undefined)[] } // by qualifying procedure
type Assignment = { candidate: Candidate; mask: number }

const MAX_PAGES = 2 // 5 D1 queries per procedure at most
const MAX_ALTERNATIVES = 3
const EPSILON = 1e-6
const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
/** Placeholder-looking names, e.g. "Dummy Group - NYNM" in the Fidelis file. */
const isPlaceholder = (name: string) => /\b(dummy|test|placeholder)\b/i.test(name) || /^EIN \S+$/.test(name)

/**
 * The fewest providers whose spend is within `tolerance` of the cheapest set of at most `max`, where each
 * procedure goes wholly to one provider. Exact: every way to split up to 8 procedures is tried.
 * Equal costs keep the earliest candidate. Null if `max` providers cannot cover everything.
 */
export function chooseProviders(
  candidates: Candidate[],
  volumes: number[],
  max: number,
  tolerance: number,
): { chosen: Assignment[]; lowest: number } | null {
  const size = 1 << volumes.length
  const full = size - 1
  const single: ({ cost: number; candidate: Candidate } | undefined)[] = new Array(size)
  for (const candidate of candidates) {
    let covers = 0
    candidate.rates.forEach((r, i) => void (r !== undefined && (covers |= 1 << i)))
    for (let mask = covers; mask > 0; mask = (mask - 1) & covers) {
      const cost = volumes.reduce((sum, v, i) => (mask & (1 << i) ? sum + v * candidate.rates[i]! : sum), 0)
      const best = single[mask]
      if (!best || cost < best.cost - EPSILON) single[mask] = { cost, candidate }
    }
  }
  type Step = { cost: number; part: number }
  // steps[k][mask]: cheapest way to cover `mask` with exactly k providers, and the part the k-th one takes.
  const steps: (Step | undefined)[][] = [new Array(size)]
  steps[0][0] = { cost: 0, part: 0 }
  for (let k = 1; k <= Math.min(max, volumes.length); k++) {
    steps[k] = new Array(size)
    for (let mask = 1; mask < size; mask++) {
      for (let part = mask; part > 0; part = (part - 1) & mask) {
        const before = steps[k - 1][mask ^ part]
        const own = single[part]
        if (!before || !own) continue
        const cost = before.cost + own.cost
        const best = steps[k][mask]
        if (!best || cost < best.cost - EPSILON) steps[k][mask] = { cost, part }
      }
    }
  }
  const lowest = Math.min(...steps.map((s) => s[full]?.cost ?? Infinity))
  if (!Number.isFinite(lowest)) return null
  let k = steps.findIndex((s) => s[full] && s[full].cost <= lowest * (1 + tolerance) + EPSILON)
  const chosen: Assignment[] = []
  for (let mask = full; k > 0; k--) {
    const { part } = steps[k][mask]!
    chosen.push({ candidate: single[part]!.candidate, mask: part })
    mask ^= part
  }
  return { chosen, lowest }
}

function splitSavings(plan: Plan, picks: { procedure: EmployerProcedure; rate: number; median: number }[]): Split[] {
  const start = startingBalances(plan)
  const points: [Split['scenario'], Balances][] = [
    ['deductible_not_met', start],
    ['deductible_met', { ...start, deductible: 0 }],
    ['out_of_pocket_met', { deductible: 0, out_of_pocket: 0 }],
  ]
  return points.map(([scenario, left]) => {
    let employees = 0
    let total = 0
    for (const { procedure: p, rate, median } of picks) {
      const pays = (r: number) => estimate(r, p.copay, plan.coinsurance, left).member_pays
      employees += p.annual_volume * (pays(median) - pays(rate))
      total += p.annual_volume * (median - rate)
    }
    return { scenario, employer: cents(total - employees), employees: cents(employees) }
  })
}

type Loaded = { procedure: EmployerProcedure; outcome: ProcedureOutcome; ranking: Ranking | null }

async function load(db: D1Database, procedure: EmployerProcedure, min: number): Promise<Loaded> {
  const { code, description, annual_volume } = procedure
  const outcome: ProcedureOutcome = {
    code, description, annual_volume, status: 'excluded', reason: null, businesses: 0,
    rates: null, variant: null, other_variants: 0, pick: null,
  }
  const excluded = (reason: ProcedureOutcome['reason'], ranking: Ranking | null = null) => ({
    procedure, outcome: { ...outcome, reason }, ranking,
  })
  if (code === null) return excluded('no_code')
  const loaded = await loadCharges(db, code, MAX_PAGES)
  if (loaded.status !== 'ok') return excluded(loaded.status)
  const ranking = rankBusinesses(loaded.charges, procedure)
  if (!ranking) return excluded('no_match')
  const rates = ranking.businesses.map((b) => b.rate)
  outcome.businesses = rates.length
  outcome.rates = { median: medianOf(rates), low: rates[0], high: rates[rates.length - 1] }
  outcome.variant = ranking.variant
  outcome.other_variants = ranking.other_variants
  if (rates.length < min) return excluded('too_few_businesses', ranking)
  return { procedure, outcome, ranking }
}

function alternatives(businesses: RankedBusiness[], provider: string, rate: number, tolerance: number): Pick['alternatives'] {
  const close = businesses.filter((b) => b.name.toLowerCase() !== provider.toLowerCase() && b.rate <= rate * (1 + tolerance) + EPSILON)
  return { total: close.length, names: close.slice(0, MAX_ALTERNATIVES).map((b) => b.name) }
}

/** Coverage first, then spend, then fewer providers. Deterministic: no LLM picks a provider or a number. */
export async function recommendProviders(db: D1Database, input: EmployerInput): Promise<Recommendation> {
  const { plan, constraints, procedures, employees } = input
  const loaded = await Promise.all(procedures.map((p) => load(db, p, constraints.min_businesses_per_procedure)))
  const qualifying = loaded.filter((l) => l.outcome.reason === null)
  const share = qualifying.length / loaded.length
  const met = qualifying.length > 0 && share >= constraints.min_basket_coverage
  const result = (status: Recommendation['status']): Recommendation => ({
    status,
    constraints,
    coverage: { qualifying: qualifying.length, total: loaded.length, share, met },
    providers: [],
    totals: null,
    procedures: loaded.map((l) => l.outcome),
  })
  if (!met) return result('coverage_not_met')

  const byKey = new Map<string, Candidate>()
  qualifying.forEach(({ ranking }, i) => {
    for (const b of ranking!.businesses) {
      const key = b.name.toLowerCase()
      const candidate = byKey.get(key) ?? { name: b.name, eins: [], rates: new Array(qualifying.length) }
      candidate.rates[i] = b.rate
      candidate.eins = [...new Set([...candidate.eins, ...b.eins])].sort()
      byKey.set(key, candidate)
    }
  })
  // Among equal prices, a real-looking name wins over a placeholder, then the first by name.
  const candidates = [...byKey].sort(
    ([a, x], [b, y]) => Number(isPlaceholder(x.name)) - Number(isPlaceholder(y.name)) || (a < b ? -1 : a > b ? 1 : 0),
  )
  const best = chooseProviders(
    candidates.map(([, c]) => c),
    qualifying.map((l) => l.procedure.annual_volume),
    constraints.max_preferred_providers,
    constraints.tie_tolerance,
  )
  if (!best) {
    for (const { outcome } of qualifying) outcome.reason = 'no_feasible_shortlist'
    return result('no_feasible_shortlist')
  }

  const picks: { procedure: EmployerProcedure; rate: number; median: number }[] = []
  const providers: Recommendation['providers'] = []
  for (const { candidate, mask } of best.chosen) {
    const provider: Recommendation['providers'][number] = {
      name: candidate.name, eins: candidate.eins, codes: [], annual_spend: 0, needs_review: isPlaceholder(candidate.name),
    }
    qualifying.forEach(({ procedure, outcome, ranking }, i) => {
      if (!(mask & (1 << i))) return
      const rate = candidate.rates[i]!
      const { median } = outcome.rates!
      const annual_spend = cents(procedure.annual_volume * rate)
      const median_spend = cents(procedure.annual_volume * median)
      outcome.status = 'recommended'
      outcome.pick = {
        provider: candidate.name,
        rate,
        annual_spend,
        median_spend,
        savings: cents(median_spend - annual_spend),
        alternatives: alternatives(ranking!.businesses, candidate.name, rate, constraints.tie_tolerance),
      }
      picks.push({ procedure, rate, median })
      provider.codes.push(procedure.code!)
      provider.annual_spend = cents(provider.annual_spend + annual_spend)
    })
    providers.push(provider)
  }
  providers.sort((a, b) => b.annual_spend - a.annual_spend || (a.name < b.name ? -1 : 1))

  const recommended = cents(picks.reduce((s, p) => s + p.procedure.annual_volume * p.rate, 0))
  const median = cents(picks.reduce((s, p) => s + p.procedure.annual_volume * p.median, 0))
  const savings = cents(median - recommended)
  return {
    ...result('recommended'),
    providers,
    totals: {
      recommended_spend: recommended,
      median_spend: median,
      savings,
      savings_percent: median > 0 ? Math.round((savings / median) * 1000) / 10 : 0,
      savings_per_employee: employees === null ? null : cents(savings / employees),
      lowest_spend: cents(best.lowest),
      split: splitSavings(plan, picks),
    },
  }
}
