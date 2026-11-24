import { beforeAll, describe, expect, it } from 'vitest'
import { handle } from '../src/index'
import { createTestDb } from './d1'

let env: { DB: D1Database }
beforeAll(() => {
  env = { DB: createTestDb() }
})

const get = async (path: string) => {
  const res = await handle(new Request(`http://x${path}`), env)
  return { status: res.status, body: (await res.json()) as any }
}

describe('health & routing', () => {
  it('health', async () => {
    expect(await get('/api/health')).toEqual({ status: 200, body: { ok: true } })
  })
  it('unknown route is 404 with error shape', async () => {
    const r = await get('/api/nope')
    expect(r.status).toBe(404)
    expect(r.body.error.code).toBe('ROUTE_NOT_FOUND')
  })
  it('POST to an unknown route is 404', async () => {
    const res = await handle(new Request('http://x/api/nope', { method: 'POST' }), env)
    expect(res.status).toBe(404)
  })
  it('non-GET is 405', async () => {
    const res = await handle(new Request('http://x/api/health', { method: 'POST' }), env)
    expect(res.status).toBe(405)
  })
})

describe('GET /api/search', () => {
  it('requires a code', async () => {
    const r = await get('/api/search')
    expect(r.status).toBe(400)
    expect(r.body.error.code).toBe('MISSING_CODE')
  })
  it('validates npi and ein', async () => {
    expect((await get('/api/search?code=99213&npi=12')).body.error.code).toBe('INVALID_NPI')
    expect((await get('/api/search?code=99213&ein=12')).body.error.code).toBe('INVALID_EIN')
  })
  it('returns rows sorted by rate desc, deduped per TIN', async () => {
    const r = await get('/api/search?code=99213')
    expect(r.status).toBe(200)
    expect(r.body.data.map((d: any) => d.negotiated_rate)).toEqual([200, 150, 100])
    // rate 0 is reachable through groups 10 and 12 (same TIN) but appears once
    expect(r.body.data.filter((d: any) => d.negotiated_rate === 100)).toHaveLength(1)
    expect(r.body.data[2].npi_count).toBe(2)
  })
  it('filters by ein (dashes ignored) and npi', async () => {
    const byEin = await get('/api/search?code=99213&ein=22-2222222')
    expect(byEin.body.data.map((d: any) => d.ein)).toEqual(['222222222'])
    const byNpi = await get('/api/search?code=99213&npi=1000000003')
    expect(byNpi.body.data).toHaveLength(1)
  })
  it('matches EINs stored with a dash, typed either way', async () => {
    for (const ein of ['444444444', '44-4444444']) {
      const r = await get(`/api/search?code=DASH1&ein=${ein}`)
      expect(r.body.data.map((d: any) => d.ein)).toEqual(['44-4444444'])
      expect((await get(`/api/providers?ein=${ein}`)).body.data).toHaveLength(1)
      expect((await get(`/api/org/${ein}`)).body.data).toHaveLength(1)
    }
  })
  it('returns the remaining source-file columns', async () => {
    const r = await get('/api/search?code=99213&ein=111111111&sort=rate_asc')
    expect(r.body.data[0]).toMatchObject({
      billing_code_type_version: '2026',
      negotiation_arrangement: 'negotiated',
      tin_type: 'ein',
      provider_group_ids: [10, 12],
    })
    expect(r.body.data[0]).toHaveProperty('additional_information')
  })
  it('visits every row exactly once across pages, in both directions', async () => {
    for (const sort of ['rate_desc', 'rate_asc']) {
      const all = (await get(`/api/search?code=99213&sort=${sort}`)).body.data
      const seen: any[] = []
      let cursor: string | null = ''
      while (cursor !== null) {
        const r: any = await get(`/api/search?code=99213&sort=${sort}&limit=1&cursor=${cursor}`)
        seen.push(...r.body.data)
        cursor = r.body.next_cursor
      }
      expect(seen).toEqual(all)
    }
  })
  it('empty result is 200, not an error', async () => {
    const r = await get('/api/search?code=00000')
    expect(r.status).toBe(200)
    expect(r.body.data).toEqual([])
  })
  it('paginates with cursor', async () => {
    const p1 = await get('/api/search?code=99213&limit=2')
    expect(p1.body.data).toHaveLength(2)
    expect(p1.body.next_cursor).toBeTruthy()
    const p2 = await get(`/api/search?code=99213&limit=2&cursor=${p1.body.next_cursor}`)
    expect(p2.body.data.map((d: any) => d.negotiated_rate)).toEqual([100])
    expect(p2.body.next_cursor).toBeNull()
  })
  it('returns service codes, modifiers and NPIs', async () => {
    const r = await get('/api/search?code=99213&ein=111111111')
    expect(r.body.data.find((d: any) => d.negotiated_rate === 100)).toMatchObject({
      service_code: ['11'],
      billing_code_modifier: ['25'],
      npis: [1000000001, 1000000002],
    })
  })
  it('rejects a cursor reused for a different query', async () => {
    const p1 = await get('/api/search?code=99213&limit=1')
    const c = p1.body.next_cursor
    for (const other of ['code=J1745', 'code=99213&sort=rate_asc', 'code=99213&setting=office', 'code=99213&ein=111111111']) {
      const r = await get(`/api/search?${other}&limit=1&cursor=${c}`)
      expect(r.status).toBe(400)
      expect(r.body.error.code).toBe('INVALID_CURSOR')
    }
  })
  it('rejects bad cursor, limit and sort', async () => {
    expect((await get('/api/search?code=99213&cursor=zzz')).body.error.code).toBe('INVALID_CURSOR')
    expect((await get('/api/search?code=99213&limit=9999')).body.error.code).toBe('INVALID_LIMIT')
    expect((await get('/api/search?code=99213&sort=x')).body.error.code).toBe('INVALID_SORT')
  })
  it('keeps alphanumeric codes', async () => {
    expect((await get('/api/search?code=0001u')).status).toBe(200)
  })
})

describe('GET /api/rates', () => {
  it('browses every priced row once, whatever the page size', async () => {
    const all = (await get('/api/rates')).body.data
    expect(all.map((d: any) => [d.billing_code, d.negotiated_rate])).toEqual([
      ['99213', 100], ['99213', 150], ['99213', 200], ['J1745', 50], ['DASH1', 10], ['MULTI', 7], ['MULTI', 7],
    ])
    for (const limit of [1, 2, 3]) {
      const seen: any[] = []
      let cursor: string | null = ''
      while (cursor !== null) {
        const r: any = await get(`/api/rates?limit=${limit}&cursor=${cursor}`)
        seen.push(...r.body.data)
        cursor = r.body.next_cursor
      }
      expect(seen).toEqual(all)
    }
  })
  it('rejects a search cursor', async () => {
    const c = (await get('/api/search?code=99213&limit=1')).body.next_cursor
    expect((await get(`/api/rates?cursor=${c}`)).body.error.code).toBe('INVALID_CURSOR')
  })
})

describe('GET /api/charges', () => {
  it('lists a row per price and provider group, skipping null rates', async () => {
    const r = await get('/api/charges?code=99213')
    expect(r.body.item).toMatchObject({ name: 'Office visit', item_count: 1 })
    expect(r.body.next_cursor).toBeNull()
    expect(r.body.data.map((d: any) => [d.business_name, d.negotiated_rate]).sort()).toEqual([
      ['Alpha Clinic', 100], // groups 10 and 12; clients count each business once
      ['Alpha Clinic', 100],
      ['Alpha Clinic', 200],
      ['Beta Hospital', 150],
    ])
    expect(r.body.data.find((d: any) => d.negotiated_rate === 100)).toMatchObject({ service_code: ['11'], billing_code_modifier: ['25'] })
  })
  it('validates and 404s', async () => {
    expect((await get('/api/charges')).body.error.code).toBe('MISSING_CODE')
    expect((await get('/api/charges?code=99213&cursor=zzz')).body.error.code).toBe('INVALID_CURSOR')
    expect((await get('/api/charges?code=NOPE1')).status).toBe(404)
  })
})

describe('GET /api/charges paging', () => {
  it('is deterministic and complete at any page size', async () => {
    const all = (await get('/api/charges?code=99213')).body.data
    for (const limit of [1, 2, 3]) {
      const seen: any[] = []
      let cursor: string | null = ''
      while (cursor !== null) {
        const r: any = await get(`/api/charges?code=99213&limit=${limit}&cursor=${cursor}`)
        seen.push(...r.body.data)
        cursor = r.body.next_cursor
      }
      expect(seen).toEqual(all)
    }
  })
})

describe('GET /api/business', () => {
  const db = { DB: createTestDb({ compare: true }) }
  const get = async (path: string) => {
    const res = await handle(new Request(`http://x${path}`), db)
    return { status: res.status, body: (await res.json()) as any }
  }
  it('compares exact variants, each business at its own median', async () => {
    const r = await get('/api/business?name=alpha%20clinic')
    expect(r.body).toMatchObject({ name: 'Alpha Clinic', ein_count: 1, next_cursor: null })
    const find = (cls: string) => r.body.data.filter((d: any) => d.code === 'CMP1' && d.billing_class === cls)
    // Alpha has 10 and 30 (median 20); Beta 40, Delta 60: market median 40
    expect(find('professional')).toMatchObject([{ rate: 20, median: 40, low: 20, high: 60, businesses: 3, place: ['11'], modifier: [] }])
    // a different class is a different procedure, priced by Alpha alone
    expect(find('institutional')).toMatchObject([{ rate: 500, median: 500, businesses: 1 }])
  })
  it('pages by code without losing or repeating procedures', async () => {
    const all = (await get('/api/business?name=Alpha%20Clinic')).body.data
    const first = await get('/api/business?name=Alpha%20Clinic&limit=1')
    expect(first.body.next_cursor).toBeTruthy()
    const second = await get(`/api/business?name=Alpha%20Clinic&limit=1&cursor=${first.body.next_cursor}`)
    expect(second.body.next_cursor).toBeNull()
    expect([...first.body.data, ...second.body.data]).toEqual(all)
    expect((await get(`/api/business?name=Beta%20Hospital&cursor=${first.body.next_cursor}`)).body.error.code).toBe('INVALID_CURSOR')
    expect((await get('/api/business?name=Alpha%20Clinic&limit=51')).body.error.code).toBe('INVALID_LIMIT')
  })
  it('does not list variants the business has no rate for', async () => {
    const r = await get('/api/business?name=Beta%20Hospital')
    expect(r.body.data.filter((d: any) => d.code === 'CMP1')).toHaveLength(1)
  })
  it('validates and 404s', async () => {
    expect((await get('/api/business')).body.error.code).toBe('MISSING_NAME')
    expect((await get('/api/business?name=nobody')).status).toBe(404)
  })
})

describe('database with only migration 0001 applied', () => {
  it('serves every endpoint the rates page uses', async () => {
    const db = { DB: createTestDb({ only0001: true }) }
    for (const path of ['rates', 'rates?limit=1', 'search?code=99213', 'search?code=99213&npi=1000000003', 'suggest?q=9921', 'providers?ein=111111111&groups=10', 'codes/99213', 'charges?code=99213', 'business?name=Alpha%20Clinic']) {
      const res = await handle(new Request(`http://x/api/${path}`), db)
      expect([path, res.status]).toEqual([path, 200])
    }
  })
})

describe('GET /api/summary', () => {
  it('summarises a code', async () => {
    const r = await get('/api/summary?code=99213')
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ price_count: 3, min: 100, max: 200, median: 150, org_count: 2, provider_count: 3 })
    expect(r.body.histogram.reduce((n: number, h: any) => n + h.count, 0)).toBe(3)
    expect(r.body.by_setting).toHaveLength(2)
  })
  it('does not count orgs/providers that only have null rates', async () => {
    const r = await get('/api/summary?code=99213')
    expect(r.body.org_count).toBe(2)
    expect(r.body.provider_count).toBe(3)
  })
  it('404 for unknown code, 400 for missing', async () => {
    expect((await get('/api/summary?code=ZZZZZ')).status).toBe(404)
    expect((await get('/api/summary')).status).toBe(400)
  })
})

describe('GET /api/suggest', () => {
  it('requires q', async () => {
    expect((await get('/api/suggest')).body.error.code).toBe('MISSING_QUERY')
  })
  it('groups code, org and provider matches', async () => {
    expect((await get('/api/suggest?q=9921')).body.codes[0].code).toBe('99213')
    expect((await get('/api/suggest?q=alpha')).body.organisations[0].ein).toBe('111111111')
    expect((await get('/api/suggest?q=lpha')).body.organisations).toEqual([]) // prefix only
    expect((await get('/api/suggest?q=1000000001')).body.providers).toEqual([{ npi: 1000000001 }])
  })
})

describe('database failures', () => {
  it('maps to DB_ERROR', async () => {
    const broken = { prepare: () => ({ bind: () => ({ all: async () => Promise.reject(new Error('boom')) }) }) }
    const res = await handle(new Request('http://x/api/search?code=99213'), { DB: broken as any })
    expect(res.status).toBe(500)
    expect(((await res.json()) as any).error.code).toBe('DB_ERROR')
  })
})

describe('GET /api/codes/:code', () => {
  it('returns metadata', async () => {
    const r = await get('/api/codes/J1745')
    expect(r.body.items[0]).toMatchObject({ type: 'HCPCS', price_count: 1 })
  })
  it('404 when unknown', async () => {
    expect((await get('/api/codes/NOPE1')).status).toBe(404)
  })
})

describe('GET /api/providers', () => {
  it('needs a filter', async () => {
    expect((await get('/api/providers')).body.error.code).toBe('MISSING_FILTER')
  })
  it('narrows by provider group', async () => {
    expect((await get('/api/providers?ein=111111111&groups=12')).body.data).toHaveLength(1)
    expect((await get('/api/providers?ein=111111111&groups=10,12')).body.data).toHaveLength(2)
    expect((await get('/api/providers?ein=111111111&groups=x')).body.error.code).toBe('INVALID_GROUPS')
  })
  it('looks up by npi', async () => {
    const r = await get('/api/providers?npi=1000000001')
    expect(r.body.data).toEqual([{ npi: 1000000001, ein: '111111111', business_name: 'Alpha Clinic' }])
  })
})

describe('GET /api/org/:ein and /api/provider/:npi', () => {
  it('org rates vs market median', async () => {
    const r = await get('/api/org/111-11-1111'.replace('111-11-1111', '111111111'))
    expect(r.status).toBe(200)
    expect(r.body.business_name).toBe('Alpha Clinic')
    expect(r.body.data[0]).toMatchObject({ code: '99213', market_median: 150, min_rate: 100, max_rate: 200 })
  })
  it('provider lists orgs and rates', async () => {
    const r = await get('/api/provider/1000000003')
    expect(r.body.orgs[0].ein).toBe('222222222')
    expect(r.body.data.map((d: any) => d.code)).toEqual(['99213', 'J1745'])
  })
  it('validates and 404s', async () => {
    expect((await get('/api/org/abc')).body.error.code).toBe('INVALID_EIN')
    expect((await get('/api/provider/1234567890')).status).toBe(404)
  })
})
