import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { analyzePlan } from '../src/priceAi/analyze'
import { estimate, startingBalances } from '../src/priceAi/estimate'
import { rankBusinesses, type Charge } from '../src/priceAi/rank'
import { parsePlanInput, type PlanInput } from '../src/priceAi/schema'
import { createTestDb } from './d1'

const plan = {
  name: 'Test',
  deductible: { total: 1000, met: 900 },
  out_of_pocket_max: { total: 2000, met: 1000 },
  coinsurance: 0.2,
}
const parse = (procedures: unknown[], overrides = {}): PlanInput => {
  const r = parsePlanInput({ plan: { ...plan, ...overrides }, procedures })
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.value
}
const errorsOf = (raw: unknown) => {
  const r = parsePlanInput(raw)
  return r.ok ? [] : r.errors
}

describe('parsePlanInput', () => {
  const dir = new URL('../../samples/price-ai/', import.meta.url)
  it.each(readdirSync(dir).filter((f) => f.endsWith(".json")))('accepts sample %s', (file) => {
    expect(errorsOf(JSON.parse(readFileSync(new URL(file, dir), 'utf8')))).toEqual([])
  })
  it.each([null, [], 'x', {}])('rejects %j', (raw) => {
    expect(errorsOf(raw)).not.toEqual([])
  })
  it('reports each problem with its path', () => {
    const errors = errorsOf({
      plan: { ...plan, coinsurance: 20, deductible: { total: 100, met: 200 } },
      procedures: [{ description: 'x', copay: -1, place: '1', modifiers: ['ABC'] }],
    })
    for (const path of ['plan.coinsurance', 'plan.deductible.met', '[0].copay', '[0].place', '[0].modifiers[0]']) {
      expect(errors.join('\n')).toContain(path)
    }
  })
  it('rejects non-finite amounts and too many procedures', () => {
    expect(errorsOf({ plan: { ...plan, coinsurance: NaN }, procedures: [{ description: 'x' }] })).toHaveLength(1)
    expect(errorsOf({ plan, procedures: Array(6).fill({ description: 'x' }) })).toHaveLength(1)
  })
  it('treats a description copied into code as a missing code', () => {
    expect(parse([{ code: 'MRI knee without contrast', description: 'x' }]).procedures[0].code).toBeNull()
  })
})

describe('estimate', () => {
  const left = { deductible: 100, out_of_pocket: 1000 }
  it('is all deductible below it', () => {
    expect(estimate(60, null, 0.2, left)).toEqual({ member_pays: 60, plan_pays: 0, after: { deductible: 40, out_of_pocket: 940 } })
  })
  it('adds coinsurance past the deductible', () => {
    expect(estimate(300, null, 0.2, left)).toEqual({ member_pays: 140, plan_pays: 160, after: { deductible: 0, out_of_pocket: 860 } })
  })
  it('stops at the out-of-pocket maximum', () => {
    expect(estimate(300, null, 0.2, { deductible: 100, out_of_pocket: 50 })).toEqual({
      member_pays: 50, plan_pays: 250, after: { deductible: 50, out_of_pocket: 0 },
    })
  })
  it('charges a copay instead, never more than the rate', () => {
    expect(estimate(300, 30, 0.2, left)).toMatchObject({ member_pays: 30, after: { deductible: 100, out_of_pocket: 970 } })
    expect(estimate(20, 30, 0.2, left).member_pays).toBe(20)
  })
  it('never falls as the rate rises', () => {
    const paid = Array.from({ length: 400 }, (_, i) => estimate(i * 25, null, 0.2, left).member_pays)
    expect(paid).toEqual([...paid].sort((a, b) => a - b))
  })
  it('starts from what is left', () => {
    expect(startingBalances(parse([{ description: 'x' }]).plan)).toEqual(left)
  })
})

describe('rankBusinesses', () => {
  const charge = (business_name: string, negotiated_rate: number, extra: Partial<Charge> = {}): Charge => ({
    business_name, negotiated_rate, ein: business_name, billing_class: 'professional', service: null,
    service_code: ['11'], billing_code_modifier: ['25'], ...extra,
  })
  const any = { modifiers: [], place: null }
  it('orders by median rate and merges names by case', () => {
    const r = rankBusinesses([charge('B', 50), charge('A', 10), charge('a', 100), charge('C', 40)], any)!
    expect(r.businesses.map((b) => [b.name, b.rate])).toEqual([['C', 40], ['B', 50], ['A', 55]])
    expect(r.assumed).toBe(false)
  })
  it('keeps variants apart and says when it picked one', () => {
    const rows = [charge('A', 50), charge('B', 60), charge('C', 5, { service_code: ['02'] })]
    expect(rankBusinesses(rows, any)).toMatchObject({ assumed: true, other_variants: 1, businesses: [{ name: 'A' }, { name: 'B' }] })
    expect(rankBusinesses(rows, { ...any, place: '02' })).toMatchObject({ assumed: false, businesses: [{ name: 'C' }] })
    expect(rankBusinesses([...rows].reverse(), any)!.variant).toEqual(rankBusinesses(rows, any)!.variant)
  })
  it('prefers an exact match over better-covered looser ones', () => {
    const loose = { billing_code_modifier: ['25', '59'] }
    const rows = [charge('A', 50), charge('B', 1, loose), charge('C', 2, loose)]
    const r = rankBusinesses(rows, { place: '11', modifiers: ['25'] })
    expect(r).toMatchObject({ assumed: false, variant: { modifiers: ['25'] }, businesses: [{ name: 'A' }] })
  })
  it('skips partial prices unless asked for', () => {
    const rows = [charge('A', 5, { billing_code_modifier: ['26'] })]
    expect(rankBusinesses(rows, any)).toBeNull()
    expect(rankBusinesses(rows, { ...any, modifiers: ['26'] })!.businesses).toHaveLength(1)
  })
})

describe('analyzePlan', () => {
  const db = createTestDb({ compare: true })
  it('ranks, prices and carries balances forward', async () => {
    const line = { code: 'cmp1', description: 'x', place: '11' }
    const r = await analyzePlan(db, parse([line, line], { deductible: { total: 30, met: 0 } }))
    const [a, b] = r.results
    if (a.status !== 'ranked' || b.status !== 'ranked') throw new Error('not ranked')
    expect(a.variant.billing_class).toBe('professional')
    expect(a.options.map((o) => [o.name, o.rate, o.member_pays])).toEqual([
      ['Alpha Clinic', 20, 20], ['Beta Hospital', 40, 32], ['Delta Dash', 60, 36],
    ])
    // $20 of the $30 deductible is used, so $10 + 20% of the other $10
    expect(b.options[0].member_pays).toBe(12)
    expect(r.total_member_pays).toBe(32)
    expect(r.remaining).toEqual({ deductible: 0, out_of_pocket: 968 })
  })
  it('reports what it cannot price without failing the rest', async () => {
    const r = await analyzePlan(db, parse([
      { description: 'MRI knee' },
      { code: 'ZZZZZ', description: 'x' },
      { code: 'CMP1', description: 'x', place: '99' },
      { code: 'J1745', description: 'x' },
    ]))
    expect(r.results.map((x) => x.status)).toEqual(['needs_code', 'not_found', 'no_match', 'ranked'])
  })
})
