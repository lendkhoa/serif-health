/** What Price AI needs to know about a plan. User JSON and LLM output are both untrusted: parse before use. */
export type Balance = { total: number; met: number }

export type Plan = {
  name: string
  insurer: string | null
  deductible: Balance
  out_of_pocket_max: Balance
  coinsurance: number // the member's share, 0 to 1
}

export type Procedure = {
  code: string | null // null until the user confirms one
  description: string
  modifiers: string[] // empty = not specified
  place: string | null // place-of-service code, e.g. "11"
  copay: number | null // replaces the deductible and coinsurance
}

export type PlanInput = { plan: Plan; procedures: Procedure[] }

export type ParseResult = { ok: true; value: PlanInput } | { ok: false; errors: string[] }

export const MAX_PROCEDURES = 5 // each one costs several D1 queries
export const MAX_TEXT = 200
const MAX_MODIFIERS = 5

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isMoney = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

export function parsePlanInput(raw: unknown): ParseResult {
  const errors: string[] = []
  const fail = (path: string, problem: string) => void errors.push(`${path} ${problem}`)

  const text = (v: unknown, path: string): string => {
    const s = typeof v === 'string' ? v.trim() : ''
    if (!s || s.length > MAX_TEXT) fail(path, `must be text of 1-${MAX_TEXT} characters`)
    return s
  }
  const optional = <T>(v: unknown, parse: (v: unknown) => T): T | null => (v === undefined || v === null ? null : parse(v))
  const money = (v: unknown, path: string): number => {
    if (isMoney(v)) return v
    fail(path, 'must be a number of 0 or more')
    return 0
  }
  const balance = (v: unknown, path: string): Balance => {
    if (!isObject(v)) {
      fail(path, 'must be an object with total and met')
      return { total: 0, met: 0 }
    }
    const result = { total: money(v.total, `${path}.total`), met: money(v.met, `${path}.met`) }
    if (result.met > result.total) fail(`${path}.met`, 'must not exceed total')
    return result
  }
  const pattern = (v: unknown, re: RegExp, path: string, problem: string): string => {
    const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
    if (!re.test(s)) fail(path, problem)
    return s
  }
  const modifiers = (v: unknown, path: string): string[] => {
    if (v === undefined || v === null) return []
    if (!Array.isArray(v) || v.length > MAX_MODIFIERS) {
      fail(path, `must be a list of at most ${MAX_MODIFIERS}`)
      return []
    }
    return v.map((m, i) => pattern(m, /^[A-Z0-9]{2}$/, `${path}[${i}]`, 'must be 2 letters or digits'))
  }
  const procedure = (v: unknown, path: string): Procedure => {
    const p = isObject(v) ? v : {}
    if (!isObject(v)) fail(path, 'must be an object')
    return {
      // A code that is not code-shaped is usually a description an LLM copied across, so it counts as missing.
      code: typeof p.code === 'string' && /^[A-Za-z0-9]{1,20}$/.test(p.code.trim()) ? p.code.trim().toUpperCase() : null,
      description: text(p.description, `${path}.description`),
      modifiers: modifiers(p.modifiers, `${path}.modifiers`),
      place: optional(p.place, (x) => pattern(x, /^[0-9]{2}$/, `${path}.place`, 'must be 2 digits')),
      copay: optional(p.copay, (x) => money(x, `${path}.copay`)),
    }
  }

  if (!isObject(raw)) return { ok: false, errors: ['input must be an object'] }
  const plan = isObject(raw.plan) ? raw.plan : {}
  if (!isObject(raw.plan)) fail('plan', 'must be an object')
  const list = Array.isArray(raw.procedures) ? raw.procedures : []
  if (list.length < 1 || list.length > MAX_PROCEDURES) fail('procedures', `must be a list of 1-${MAX_PROCEDURES}`)

  const coinsurance = money(plan.coinsurance, 'plan.coinsurance')
  if (coinsurance > 1) fail('plan.coinsurance', 'must be a fraction from 0 to 1, e.g. 0.2')

  const value: PlanInput = {
    plan: {
      name: text(plan.name, 'plan.name'),
      insurer: optional(plan.insurer, (x) => text(x, 'plan.insurer')),
      deductible: balance(plan.deductible, 'plan.deductible'),
      out_of_pocket_max: balance(plan.out_of_pocket_max, 'plan.out_of_pocket_max'),
      coinsurance,
    },
    procedures: list.slice(0, MAX_PROCEDURES).map((p, i) => procedure(p, `procedures[${i}]`)),
  }
  return errors.length ? { ok: false, errors } : { ok: true, value }
}
