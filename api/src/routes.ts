import { ApiError, ERROR_CODES, badRequest, notFound } from './errors'
import {
  decodeCursor,
  encodeCursor,
  keysetWhere,
  parseCode,
  parseEin,
  parseLimit,
  parseNpi,
  parseSort,
} from './validation'

type Params = URLSearchParams
type Row = Record<string, any>

async function all(db: D1Database, sql: string, params: unknown[] = []): Promise<Row[]> {
  try {
    const { results } = await db
      .prepare(sql)
      .bind(...params)
      .all<Row>()
    return results
  } catch (err) {
    console.error(err)
    throw new ApiError(ERROR_CODES.DB_ERROR, 500)
  }
}

const NPI_PREVIEW = 25

function parseJson(value: unknown): any {
  if (typeof value !== 'string') return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const first = async (db: D1Database, sql: string, params: unknown[] = []) =>
  (await all(db, sql, params))[0]

function page<T extends Row>(rows: T[], limit: number, signature: string, keyOf: (row: T) => unknown[]) {
  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  return { data, next_cursor: hasMore ? encodeCursor(signature, keyOf(data[data.length - 1])) : null, limit }
}

// GET /api/search?code=&npi=&ein=&setting=&class=&sort=&limit=&cursor=
export async function search(db: D1Database, q: Params) {
  const code = parseCode(q.get('code'))
  const npi = parseNpi(q.get('npi'))
  const ein = parseEin(q.get('ein') ?? q.get('tin')) // `tin` accepted as alias
  const sort = parseSort(q.get('sort'))
  const limit = parseLimit(q.get('limit'))
  const setting = q.get('setting') || undefined
  const billingClass = q.get('class') || undefined
  const signature = JSON.stringify(['search', code, npi, ein, setting, billingClass, sort])
  const cursor = decodeCursor(q.get('cursor'), signature, 5)

  const where = ['b.billing_code = ?', 'p.negotiated_rate IS NOT NULL']
  const params: unknown[] = [code]
  if (ein) (where.push('t.tin_value = ?'), params.push(ein))
  if (npi) {
    where.push(
      'EXISTS (SELECT 1 FROM provider_npis n WHERE n.provider_group_id = r.provider_group_id AND n.tin_value = t.tin_value AND n.npi = ?)',
    )
    params.push(npi)
  }
  if (setting) (where.push('p.setting = ?'), params.push(setting))
  if (billingClass) (where.push('p.billing_class = ?'), params.push(billingClass))

  const rateDir = sort === 'rate_asc' ? 'ASC' : 'DESC'
  const keyCols = [
    { expr: 'p.negotiated_rate', dir: rateDir },
    { expr: 'p.item_id', dir: 'ASC' },
    { expr: 'p.rate_idx', dir: 'ASC' },
    { expr: 'p.price_idx', dir: 'ASC' },
    { expr: 't.tin_value', dir: 'ASC' },
  ] as const
  if (cursor) {
    const ks = keysetWhere([...keyCols], cursor)
    where.push(ks.sql)
    params.push(...ks.params)
  }

  // One row per (rate, TIN); GROUP BY dedupes TINs reached via several provider_references.
  const rows = await all(
    db,
    `SELECT b.billing_code, b.billing_code_type, b.name, b.description,
            p.negotiated_rate, p.negotiated_type, p.billing_class, p.setting, p.expiration_date,
            p.service_code, p.billing_code_modifier,
            b.source_file_id, sf.name AS source_file, sf.url AS source_file_url, sf.last_updated_on AS source_last_updated_on,
            p.item_id, p.rate_idx, p.price_idx,
            t.tin_value AS ein, t.business_name,
            (SELECT COUNT(DISTINCT n2.npi)
               FROM rate_provider_groups r2
               JOIN provider_npis n2 ON n2.provider_group_id = r2.provider_group_id AND n2.tin_value = t.tin_value
              WHERE r2.item_id = p.item_id AND r2.rate_idx = p.rate_idx) AS npi_count,
            (SELECT json_group_array(npi) FROM (
               SELECT DISTINCT n3.npi AS npi
                 FROM rate_provider_groups r3
                 JOIN provider_npis n3 ON n3.provider_group_id = r3.provider_group_id AND n3.tin_value = t.tin_value
                WHERE r3.item_id = p.item_id AND r3.rate_idx = p.rate_idx
                ORDER BY n3.npi LIMIT ${NPI_PREVIEW})) AS npis
       FROM billing_items b
       LEFT JOIN source_files sf ON sf.source_file_id = b.source_file_id
       JOIN negotiated_prices p ON p.item_id = b.item_id
       JOIN rate_provider_groups r ON r.item_id = p.item_id AND r.rate_idx = p.rate_idx
       JOIN provider_tins t ON t.provider_group_id = r.provider_group_id
      WHERE ${where.join(' AND ')}
      GROUP BY p.item_id, p.rate_idx, p.price_idx, t.tin_value
      ORDER BY ${keyCols.map((c) => `${c.expr} ${c.dir}`).join(', ')}
      LIMIT ?`,
    [...params, limit + 1],
  )
  const result = page(rows, limit, signature, (r) => [r.negotiated_rate, r.item_id, r.rate_idx, r.price_idx, r.ein])
  return {
    ...result,
    data: result.data.map((r) => ({
      ...r,
      service_code: parseJson(r.service_code),
      billing_code_modifier: parseJson(r.billing_code_modifier),
      npis: parseJson(r.npis) ?? [], // first NPI_PREVIEW NPIs; see npi_count for the total
    })),
  }
}

// GET /api/summary?code=   (reads the precomputed code_summary; see scripts/build_code_summary.sql)
export async function summary(db: D1Database, q: Params) {
  const code = parseCode(q.get('code'))
  const row = await first(db, `SELECT * FROM code_summary WHERE billing_code = ?`, [code])
  if (!row) throw notFound()

  const width = (row.max_rate - row.min_rate) / 10
  return {
    code,
    price_count: row.price_count,
    org_count: row.org_count,
    provider_count: row.provider_count,
    min: row.min_rate,
    p25: row.p25,
    median: row.median,
    p75: row.p75,
    max: row.max_rate,
    histogram: (parseJson(row.histogram) ?? []).map((h: Row) => ({
      from: row.min_rate + h.bucket * width,
      to: row.min_rate + (h.bucket + 1) * width,
      count: h.count,
    })),
    by_setting: parseJson(row.by_setting) ?? [],
    by_billing_class: parseJson(row.by_billing_class) ?? [],
    by_negotiated_type: parseJson(row.by_negotiated_type) ?? [],
  }
}

/** Case-insensitive prefix as an index range scan (pair with a COLLATE NOCASE index). */
const prefixRange = (prefix: string): [string, string] => [prefix, `${prefix}\u{10ffff}`]

// GET /api/suggest?q=   (prefix matches only, so every lookup is an index range scan)
export async function suggest(db: D1Database, q: Params) {
  const text = q.get('q')?.trim() ?? ''
  if (!text) throw badRequest(ERROR_CODES.MISSING_QUERY)
  const digits = text.replace(/-/g, '')
  const GROUP_LIMIT = 5
  const [codeLo, codeHi] = prefixRange(text.toUpperCase())
  const [nameLo, nameHi] = prefixRange(text)

  const [codes, organisations, providers] = await Promise.all([
    all(
      db,
      `SELECT billing_code AS code, billing_code_type AS type, name, description FROM billing_items
        WHERE billing_code >= ? AND billing_code <= ?
        GROUP BY billing_code ORDER BY billing_code LIMIT ?`,
      [codeLo, codeHi, GROUP_LIMIT],
    ),
    all(
      db,
      `SELECT tin_value AS ein, MIN(business_name) AS business_name FROM provider_tins
        WHERE (business_name COLLATE NOCASE >= ? AND business_name COLLATE NOCASE <= ?)
           OR (? AND tin_value >= ? AND tin_value <= ?)
        GROUP BY tin_value ORDER BY business_name LIMIT ?`,
      [nameLo, nameHi, /^\d+$/.test(digits) ? 1 : 0, digits, `${digits}\u{10ffff}`, GROUP_LIMIT],
    ),
    /^\d{10}$/.test(digits)
      ? all(db, `SELECT DISTINCT npi FROM provider_npis WHERE npi = ? LIMIT ?`, [Number(digits), GROUP_LIMIT])
      : Promise.resolve([]),
  ])
  return { q: text, codes, organisations, providers }
}

// GET /api/codes/:code
export async function codeDetail(db: D1Database, rawCode: string) {
  const code = parseCode(rawCode)
  const items = await all(
    db,
    `SELECT b.item_id, b.billing_code AS code, b.billing_code_type AS type, b.billing_code_type_version AS type_version,
            b.name, b.description, b.negotiation_arrangement,
            (SELECT COUNT(*) FROM negotiated_prices p WHERE p.item_id = b.item_id) AS price_count
       FROM billing_items b WHERE b.billing_code = ? ORDER BY b.item_id`,
    [code],
  )
  if (items.length === 0) throw notFound()
  return { code, items }
}

// GET /api/providers?npi=&ein=&limit=&cursor=
export async function providers(db: D1Database, q: Params) {
  const npi = parseNpi(q.get('npi'))
  const ein = parseEin(q.get('ein') ?? q.get('tin'))
  if (npi === undefined && ein === undefined) throw badRequest(ERROR_CODES.MISSING_FILTER)
  const limit = parseLimit(q.get('limit'))
  const signature = JSON.stringify(['providers', npi, ein])
  const cursor = decodeCursor(q.get('cursor'), signature, 2)

  const where: string[] = []
  const params: unknown[] = []
  if (npi !== undefined) (where.push('n.npi = ?'), params.push(npi))
  if (ein !== undefined) (where.push('n.tin_value = ?'), params.push(ein))
  if (cursor) {
    const ks = keysetWhere(
      [
        { expr: 'n.npi', dir: 'ASC' },
        { expr: 'n.tin_value', dir: 'ASC' },
      ],
      cursor,
    )
    where.push(ks.sql)
    params.push(...ks.params)
  }
  const rows = await all(
    db,
    `SELECT n.npi, n.tin_value AS ein, MIN(t.business_name) AS business_name
       FROM provider_npis n
       LEFT JOIN provider_tins t ON t.provider_group_id = n.provider_group_id AND t.tin_value = n.tin_value
      WHERE ${where.join(' AND ')}
      GROUP BY n.npi, n.tin_value ORDER BY n.npi, n.tin_value LIMIT ?`,
    [...params, limit + 1],
  )
  return page(rows, limit, signature, (r) => [r.npi, r.ein])
}

/** Per-code rates for an entity (TIN or NPI) alongside the market median for each code. */
async function entityRates(
  db: D1Database,
  kind: 'org' | 'provider',
  groupsSql: string,
  groupParam: unknown,
  q: Params,
) {
  const limit = parseLimit(q.get('limit'), 50)
  const signature = JSON.stringify([kind, groupParam])
  const cursor = decodeCursor(q.get('cursor'), signature, 1)

  const rows = await all(
    db,
    `SELECT b.billing_code AS code, MIN(b.name) AS name, COUNT(*) AS price_count,
            MIN(p.negotiated_rate) AS min_rate, MAX(p.negotiated_rate) AS max_rate, AVG(p.negotiated_rate) AS avg_rate
       FROM (SELECT DISTINCT r.item_id, r.rate_idx FROM rate_provider_groups r
              WHERE r.provider_group_id IN (${groupsSql})) e
       JOIN negotiated_prices p ON p.item_id = e.item_id AND p.rate_idx = e.rate_idx
       JOIN billing_items b ON b.item_id = p.item_id
      WHERE p.negotiated_rate IS NOT NULL ${cursor ? 'AND b.billing_code > ?' : ''}
      GROUP BY b.billing_code ORDER BY b.billing_code LIMIT ?`,
    [groupParam, ...(cursor ? [cursor[0]] : []), limit + 1],
  )
  const result = page(rows, limit, signature, (r) => [r.code])

  const codes = result.data.map((r) => r.code)
  const medians = new Map<string, number>()
  if (codes.length) {
    const marks = codes.map(() => '?').join(',')
    const med = await all(
      db,
      `SELECT code, AVG(rate) AS median FROM (
         SELECT b.billing_code AS code, p.negotiated_rate AS rate,
                ROW_NUMBER() OVER (PARTITION BY b.billing_code ORDER BY p.negotiated_rate) AS rn,
                COUNT(*) OVER (PARTITION BY b.billing_code) AS cnt
           FROM negotiated_prices p JOIN billing_items b ON b.item_id = p.item_id
          WHERE b.billing_code IN (${marks}) AND p.negotiated_rate IS NOT NULL)
        WHERE rn IN ((cnt + 1) / 2, (cnt + 2) / 2) GROUP BY code`,
      codes,
    )
    med.forEach((m) => medians.set(m.code, m.median))
  }
  return {
    ...result,
    data: result.data.map((r) => {
      const market = medians.get(r.code) ?? null
      return {
        ...r,
        market_median: market,
        vs_median: market ? r.avg_rate / market : null, // 1.0 = at market median
      }
    }),
  }
}

// GET /api/org/:ein
export async function org(db: D1Database, rawEin: string, q: Params) {
  const ein = parseEin(rawEin)
  if (!ein) throw badRequest(ERROR_CODES.INVALID_EIN)
  const info = await first(
    db,
    `SELECT MIN(business_name) AS business_name, COUNT(DISTINCT provider_group_id) AS group_count
       FROM provider_tins WHERE tin_value = ?`,
    [ein],
  )
  if (!info || info.group_count === 0) throw notFound()
  const rates = await entityRates(
    db,
    'org',
    `SELECT provider_group_id FROM provider_tins WHERE tin_value = ?`,
    ein,
    q,
  )
  return { ein, business_name: info.business_name, ...rates }
}

// GET /api/provider/:npi
export async function provider(db: D1Database, rawNpi: string, q: Params) {
  const npi = parseNpi(rawNpi)
  if (npi === undefined) throw badRequest(ERROR_CODES.INVALID_NPI)
  const orgs = await all(
    db,
    `SELECT n.tin_value AS ein, MIN(t.business_name) AS business_name
       FROM provider_npis n
       LEFT JOIN provider_tins t ON t.provider_group_id = n.provider_group_id AND t.tin_value = n.tin_value
      WHERE n.npi = ? GROUP BY n.tin_value ORDER BY n.tin_value`,
    [npi],
  )
  if (orgs.length === 0) throw notFound()
  const rates = await entityRates(
    db,
    'provider',
    `SELECT provider_group_id FROM provider_npis WHERE npi = ?`,
    npi,
    q,
  )
  return { npi, orgs, ...rates }
}
