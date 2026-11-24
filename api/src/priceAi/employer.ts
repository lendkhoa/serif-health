import { isObject, parsePlanInput, type Plan, type Procedure } from './schema'

export type Constraints = {
  min_businesses_per_procedure: number
  min_basket_coverage: number // share of procedures that must have enough businesses
  max_preferred_providers: number
  tie_tolerance: number // how much more may be spent to use fewer providers
}

export type EmployerProcedure = Procedure & { annual_volume: number }

export type EmployerInput = {
  plan: Plan
  employees: number | null
  constraints: Constraints
  procedures: EmployerProcedure[]
}

/** `errors` is null when the message holds no JSON object at all. */
export type EmployerParse = { ok: true; value: EmployerInput } | { ok: false; errors: string[] | null }

export const MAX_EMPLOYER_PROCEDURES = 8 // keeps a request under D1's 50-query limit; see recommend.ts
const MAX_COUNT = 100_000_000

/** Finds the JSON context in a chat message and checks it. The wording around it does not affect the results. */
export function parseEmployerMessage(message: unknown): EmployerParse {
  if (typeof message !== 'string') return { ok: false, errors: null }
  const start = message.indexOf('{')
  const end = message.lastIndexOf('}')
  let raw: unknown
  try {
    raw = JSON.parse(message.slice(start, end + 1))
  } catch {
    return { ok: false, errors: null }
  }
  if (!isObject(raw)) return { ok: false, errors: null }

  const parsed = parsePlanInput(raw, MAX_EMPLOYER_PROCEDURES)
  const errors = parsed.ok ? [] : [...parsed.errors]
  const number = (v: unknown, path: string, min: number, max: number, whole: boolean): number => {
    if (typeof v === 'number' && v >= min && v <= max && (!whole || Number.isInteger(v))) return v
    errors.push(`${path} must be a ${whole ? 'whole ' : ''}number from ${min} to ${max}`)
    return min
  }
  if (raw.audience !== 'employer') errors.push('audience must be "employer"')
  const c = isObject(raw.constraints) ? raw.constraints : {}
  if (!isObject(raw.constraints)) errors.push('constraints must be an object')
  const constraints: Constraints = {
    min_businesses_per_procedure: number(c.min_businesses_per_procedure, 'constraints.min_businesses_per_procedure', 1, 10_000, true),
    min_basket_coverage: number(c.min_basket_coverage, 'constraints.min_basket_coverage', 0, 1, false),
    max_preferred_providers: number(c.max_preferred_providers, 'constraints.max_preferred_providers', 1, 100, true),
    tie_tolerance: number(c.tie_tolerance, 'constraints.tie_tolerance', 0, 1, false),
  }
  const population = isObject(raw.population) ? raw.population : {}
  const employees =
    population.employees === undefined || population.employees === null
      ? null
      : number(population.employees, 'population.employees', 1, MAX_COUNT, true)
  const volumes = (Array.isArray(raw.procedures) ? raw.procedures : [])
    .slice(0, MAX_EMPLOYER_PROCEDURES)
    .map((p, i) => number(isObject(p) ? p.annual_volume : undefined, `procedures[${i}].annual_volume`, 1, MAX_COUNT, true))

  if (!parsed.ok || errors.length) return { ok: false, errors }
  const { plan, procedures } = parsed.value
  return {
    ok: true,
    value: {
      plan,
      employees,
      constraints,
      procedures: procedures.map((p, i) => ({ ...p, annual_volume: volumes[i] })),
    },
  }
}
