import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { handle } from '../src/index'
import { MAX_PLAN_BYTES } from '../src/priceAi/routes'
import { createTestDb } from './d1'

const env = { DB: createTestDb({ compare: true }) }
const URL_ANALYZE = 'http://x/api/price-ai/analyze'
const plan = {
  name: 'Test',
  deductible: { total: 1000, met: 900 },
  out_of_pocket_max: { total: 2000, met: 1000 },
  coinsurance: 0.2,
}

const send = async (init: RequestInit, url = URL_ANALYZE) => {
  const res = await handle(new Request(url, init), env)
  return { status: res.status, headers: res.headers, body: (await res.json()) as any }
}
const post = (body: BodyInit | null) => send({ method: 'POST', body })
const analyze = (procedures: unknown[]) => post(JSON.stringify({ plan, procedures }))
const search = (q: string) => send({}, `http://x/api/price-ai/codes?q=${encodeURIComponent(q)}`)
const codesOf = async (q: string) => (await search(q)).body.codes.map((c: any) => c.code)

describe('POST /api/price-ai/analyze', () => {
  it('prices a plan and returns chart data', async () => {
    const r = await analyze([{ code: 'CMP1', description: 'x', place: '11' }])
    expect(r.status).toBe(200)
    expect(r.headers.get('Cache-Control')).toBe('no-store')
    expect(r.body.results[0]).toMatchObject({ status: 'ranked', total_businesses: 3, rates: { median: 40, low: 20, high: 60 } })
    expect(r.body.results[0].options[0]).toMatchObject({ name: 'Alpha Clinic', rate: 20, member_pays: 20, plan_pays: 0 })
    expect(r.body).toMatchObject({ total_member_pays: 20, remaining: { deductible: 80, out_of_pocket: 980 } })
  })
  it('covers every ranked business in the chart data, not only the top 10', async () => {
    const charge = Array.from({ length: 12 }, (_, i) => ({
      rate_idx: i, price_idx: 0, provider_group_id: i, business_name: `B${i}`, ein: String(i), negotiated_rate: (i + 1) * 10,
    }))
    const db = { prepare: (sql: string) => ({ bind: () => ({ all: async () => ({
      results: sql.includes('item_count') ? [{ item_id: 1, name: 'Many' }] : sql.includes('CROSS JOIN') ? charge : [],
    }) }) }) }
    const body = JSON.stringify({ plan, procedures: [{ code: 'MANY', description: 'x' }] })
    const res = await handle(new Request(URL_ANALYZE, { method: 'POST', body }), { DB: db as any })
    const [result] = ((await res.json()) as any).results
    expect(result.options).toHaveLength(10)
    expect(result).toMatchObject({ total_businesses: 12, rates: { median: 65, low: 10, high: 120 } })
  })
  it('suggests codes when one is missing or unknown, and a pick can be priced', async () => {
    const r = await analyze([
      { description: 'MRI knee' },
      { code: 'ZZZZZ', description: 'MRI knee' },
    ])
    expect(r.body.results.map((x: any) => x.status)).toEqual(['needs_code', 'not_found'])
    for (const x of r.body.results) expect(x.suggestions.map((s: any) => s.code)).toEqual(['73721', '73722'])
    const picked = await analyze([{ code: r.body.results[0].suggestions[0].code, description: 'MRI knee' }])
    expect(picked.body.results[0]).toMatchObject({ status: 'ranked', options: [{ name: 'Eta Imaging' }] })
  })
  it.each(['', '{', 'plan=1'])('rejects malformed JSON %j', async (body) => {
    expect(await post(body)).toMatchObject({ status: 400, body: { error: { code: 'INVALID_JSON' } } })
  })
  it('rejects a body that is missing or not UTF-8', async () => {
    expect((await post(null)).body.error.code).toBe('INVALID_JSON')
    expect((await post(new Uint8Array([0x22, 0xff, 0x22]))).body.error.code).toBe('INVALID_JSON')
  })
  it('lists every problem with an invalid plan', async () => {
    const r = await post(JSON.stringify({ plan: { ...plan, coinsurance: 20 }, procedures: [] }))
    expect(r).toMatchObject({ status: 400, body: { error: { code: 'INVALID_PLAN' } } })
    expect(r.body.error.details).toHaveLength(2)
    expect((await post('null')).body.error.code).toBe('INVALID_PLAN')
  })
  it('limits the body size, counted in bytes', async () => {
    const good = JSON.stringify({ plan, procedures: [{ code: 'CMP1', description: 'x' }] })
    expect((await post(good.padEnd(MAX_PLAN_BYTES))).status).toBe(200)
    expect(await post(good.padEnd(MAX_PLAN_BYTES + 1))).toMatchObject({ status: 413, body: { error: { code: 'BODY_TOO_LARGE' } } })
    expect((await post('é'.repeat(MAX_PLAN_BYTES / 2 + 1))).status).toBe(413)
    expect((await send({ method: 'POST', body: good, headers: { 'Content-Length': '999999' } })).status).toBe(413)
  })
  it('stops reading an oversized stream', async () => {
    let pulls = 0
    const body = new ReadableStream({ pull: (c) => (pulls++, c.enqueue(new Uint8Array(4096).fill(32))) })
    expect((await send({ method: 'POST', body, duplex: 'half' } as RequestInit)).status).toBe(413)
    expect(pulls).toBeLessThan(10)
  })
  it('allows only POST', async () => {
    expect(await send({})).toMatchObject({ status: 405, body: { error: { code: 'METHOD_NOT_ALLOWED' } } })
    expect((await send({ method: 'POST' }, 'http://x/api/price-ai/codes?q=x')).status).toBe(405)
  })
  it('reports a database failure', async () => {
    const DB = { prepare: () => ({ bind: () => ({ all: async () => Promise.reject(new Error('boom')) }) }) } as any
    const body = readFileSync(new URL('../../samples/price-ai/missing-code.json', import.meta.url), 'utf8')
    const res = await handle(new Request(URL_ANALYZE, { method: 'POST', body }), { DB })
    expect(res.status).toBe(500)
    expect(((await res.json()) as any).error.code).toBe('DB_ERROR')
  })
})

describe('GET /api/price-ai/codes', () => {
  it('finds a knee MRI under the wording of the rate file', async () => {
    expect(await codesOf('MRI knee')).toEqual(['73721', '73722'])
  })
  it('leaves out revenue codes and codes with no dollar rate', async () => {
    const codes = await codesOf('MRI')
    expect(codes).toEqual(expect.arrayContaining(['73718', '73721', '73722']))
    expect(codes).not.toContain('610')
    expect(codes).not.toContain('73723')
  })
  it('tells with and without contrast apart', async () => {
    expect((await codesOf('mri of my knee, w/o contrast'))[0]).toBe('73721')
    expect((await codesOf('MRI knee with contrast'))[0]).toBe('73722')
  })
  it('matches a code, and returns nothing for unknown words', async () => {
    expect(await codesOf('73721')).toEqual(['73721'])
    expect(await codesOf('zzz constructor')).toEqual([])
    expect(await codesOf('%')).toEqual([])
  })
  it('needs a query of at most 200 characters', async () => {
    expect((await search(' ')).body.error.code).toBe('MISSING_QUERY')
    expect((await search('x'.repeat(201))).body.error.code).toBe('QUERY_TOO_LONG')
  })
})
