import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { handle } from '../src/index'
import { parseEmployerMessage } from '../src/priceAi/employer'
import { explain, isGrounded } from '../src/priceAi/explain'
import { chooseProviders, recommendProviders } from '../src/priceAi/recommend'
import { createTestDb } from './d1'
import { fakeProvider } from './fakeProvider'

const PROMPT = readFileSync(new URL('../../samples/price-ai/employer-prompt.txt', import.meta.url), 'utf8')
const DB = createTestDb({ compare: true })
const context = (overrides: object = {}) => ({
  audience: 'employer',
  plan: { name: 'T', deductible: { total: 1000, met: 0 }, out_of_pocket_max: { total: 2000, met: 0 }, coinsurance: 0.2 },
  population: { employees: 10 },
  constraints: { min_businesses_per_procedure: 2, min_basket_coverage: 0.5, max_preferred_providers: 5, tie_tolerance: 0.05 },
  procedures: [
    { code: 'CMP1', description: 'Compared', place: '11', annual_volume: 100 },
    { code: '73721', description: 'MRI knee', annual_volume: 10 }, // one business
  ],
  ...overrides,
})
const post = async (path: string, message: unknown) => {
  const res = await handle(new Request(`http://x/api/price-ai/${path}`, { method: 'POST', body: JSON.stringify({ message }) }), { DB })
  return { status: res.status, body: (await res.json()) as any }
}
const ask = (overrides?: object) => post('recommend', `Which? ${JSON.stringify(context(overrides))}`)

describe('parseEmployerMessage', () => {
  it('reads the example prompt', () => {
    const r = parseEmployerMessage(PROMPT)
    if (!r.ok) throw new Error(String(r.errors))
    expect(r.value.procedures).toHaveLength(8)
    expect(r.value.procedures[0]).toMatchObject({ code: '99213', copay: 30, annual_volume: 14000 })
    expect(r.value).toMatchObject({ employees: 5000, constraints: { tie_tolerance: 0.05 } })
  })
  it('reports every problem', () => {
    const r = parseEmployerMessage(JSON.stringify({ ...context(), audience: 'member', constraints: {}, procedures: [{ description: 'x' }] }))
    expect(r.ok ? [] : r.errors).toHaveLength(6)
  })
})

describe('POST /api/price-ai/recommend', () => {
  it('excludes thin procedures and prices the rest', async () => {
    const { status, body } = await ask()
    expect(status).toBe(200)
    expect(body).toMatchObject({ status: 'recommended', coverage: { qualifying: 1, total: 2, met: true } })
    expect(body.providers).toMatchObject([{ name: 'Alpha Clinic', codes: ['CMP1'], annual_spend: 2000 }])
    expect(body.procedures[1]).toMatchObject({ status: 'excluded', reason: 'too_few_businesses', businesses: 1, pick: null })
    // Alpha 20 against a median of 40, 100 times; the deductible makes the member pay all, then 20%, then nothing.
    expect(body.totals).toMatchObject({
      recommended_spend: 2000, median_spend: 4000, savings: 2000, savings_percent: 50, savings_per_employee: 200,
      split: [{ employer: 0, employees: 2000 }, { employer: 1600, employees: 400 }, { employer: 2000, employees: 0 }],
    })
  })
  it('gives all the savings to the employer under a copay below both rates', async () => {
    const { body } = await ask({ procedures: [{ code: 'CMP1', description: 'x', place: '11', copay: 5, annual_volume: 1 }] })
    expect(body.totals.split.map((s: any) => s.employees)).toEqual([0, 0, 0])
  })
  it('recommends nothing when basket coverage is too low', async () => {
    const { body } = await ask({ constraints: { ...context().constraints, min_basket_coverage: 0.8 } })
    expect(body).toMatchObject({ status: 'coverage_not_met', providers: [], totals: null })
  })
  it('rejects a message without usable JSON, or with an invalid context', async () => {
    for (const m of ['hello', '{oops}', undefined, 'x }{'])
      expect(await post('recommend', m)).toMatchObject({ status: 400, body: { error: { code: 'MISSING_CONTEXT' } } })
    const { body } = await ask({ audience: 'member' })
    expect(body.error).toMatchObject({ code: 'INVALID_PLAN', details: ['audience must be "employer"'] })
  })
})

describe('chooseProviders', () => {
  const c = (name: string, ...rates: (number | undefined)[]) => ({ name, eins: [], rates })
  const names = (tolerance: number, max = 5) =>
    chooseProviders([c('A', 10, undefined), c('B', undefined, 10), c('Both', 10.4, 10.4)], [1, 1], max, tolerance)?.chosen.map((x) => x.candidate.name).sort()
  it('prefers fewer providers only within the tolerance', () => {
    expect(names(0.05)).toEqual(['Both'])
    expect(names(0.03)).toEqual(['A', 'B'])
    expect(names(0.03, 1)).toEqual(['Both'])
  })
  it('weighs rates by volume', () => {
    const r = chooseProviders([c('A', 10, 20), c('B', 20, 10)], [100, 1], 1, 0)
    expect(r?.chosen[0].candidate.name).toBe('A')
    expect(r?.lowest).toBe(1020)
  })
  it('reports when the limit cannot cover everything', () => {
    expect(chooseProviders([c('A', 1, undefined), c('B', undefined, 1)], [1, 1], 1, 0)).toBeNull()
  })
})

describe('explain', () => {
  const run = async (reply: unknown) => {
    const input = parseEmployerMessage(JSON.stringify(context()))
    if (!input.ok) throw new Error()
    return explain([fakeProvider([reply] as any).provider], await recommendProviders(DB, input.value))
  }
  it('keeps a summary whose numbers are in the results', async () => {
    expect(await run({ summary: 'You could save up to $2,000 a year (50%).' })).toMatchObject({ summary: 'You could save up to $2,000 a year (50%).' })
  })
  it('falls back on invented or rescaled numbers, or no text', async () => {
    for (const reply of [{ summary: 'Save $9,999.' }, { summary: 'Save $2,000 million.' }, {}])
      expect(await run(reply)).toMatchObject({ source: 'template', summary: expect.stringContaining('$2,000') })
  })
  it('works with no model', async () => {
    const r = await post('explain', JSON.stringify(context()))
    expect(r).toMatchObject({ status: 200, body: { source: 'template' } })
  })
  it('matches numbers whatever their formatting', () => {
    expect(isGrounded('saves 1046410', '$1,046,410')).toBe(true)
    expect(isGrounded('saves $1.05', '$1,046,410')).toBe(false)
  })
})
