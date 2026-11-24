import { ApiError, ERROR_CODES, badRequest, notFound } from './errors'
import {
  MAX_GROUPS,
  decodeCursor,
  einForms,
  encodeCursor,
  keysetWhere,
  parseCode,
  parseEin,
  parseGroups,
  parseLimit,
  parseNpi,
  parseSort,
} from './validation'

type Params = URLSearchParams
type Row = Record<string, any>

export async function all(db: D1Database, sql: string, params: unknown[] = []): Promise<Row[]> {
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

/** Expands a CTE `page` of (price, TIN) keys into full rows. Runs only for the rows on the page.
 *  Uses migration 0001 tables only, so it works on a database where 0002 is not applied. */
const RATE_ROW_SELECT = `SELECT b.billing_code, b.billing_code_type, b.billing_code_type_version, b.name, b.description,
            b.negotiation_arrangement,
            g.negotiated_rate, p.negotiated_type, p.billing_class, p.setting, p.expiration_date,
            p.additional_information, p.service_code, p.billing_code_modifier,
            g.item_id, g.rate_idx, g.price_idx,
            g.ein, g.tin_type, g.business_name,
            (SELECT COUNT(DISTINCT n2.npi)
               FROM rate_provider_groups r2
               JOIN provider_npis n2 ON n2.provider_group_id = r2.provider_group_id AND n2.tin_value = g.ein
              WHERE r2.item_id = g.item_id AND r2.rate_idx = g.rate_idx) AS npi_count,
            (SELECT json_group_array(npi) FROM (
               SELECT DISTINCT n3.npi AS npi
                 FROM rate_provider_groups r3
                 JOIN provider_npis n3 ON n3.provider_group_id = r3.provider_group_id AND n3.tin_value = g.ein
                WHERE r3.item_id = g.item_id AND r3.rate_idx = g.rate_idx
                ORDER BY n3.npi LIMIT ${NPI_PREVIEW})) AS npis,
            (SELECT json_group_array(provider_group_id) FROM (
               SELECT r4.provider_group_id
                 FROM rate_provider_groups r4
                 JOIN provider_tins t4 ON t4.provider_group_id = r4.provider_group_id AND t4.tin_value = g.ein
                WHERE r4.item_id = g.item_id AND r4.rate_idx = g.rate_idx
                ORDER BY r4.provider_group_id LIMIT ${MAX_GROUPS})) AS provider_group_ids
       FROM page g
       JOIN billing_items b ON b.item_id = g.item_id
       JOIN negotiated_prices p ON p.item_id = g.item_id AND p.rate_idx = g.rate_idx AND p.price_idx = g.price_idx`

const toRateRow = (r: Row) => ({
  ...r,
  service_code: parseJson(r.service_code),
  billing_code_modifier: parseJson(r.billing_code_modifier),
  provider_group_ids: parseJson(r.provider_group_ids) ?? [],
  npis: parseJson(r.npis) ?? [], // first NPI_PREVIEW NPIs; see npi_count for the total
})

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
  if (ein) (where.push('t.tin_value IN (?, ?)'), params.push(...einForms(ein)))
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
  // The page is chosen first, from keys only. Everything expensive (NPI lists, text columns) is
  // looked up for at most limit + 1 rows, never for the code's whole rate x TIN fan-out.
  const rows = await all(
    db,
    `WITH page AS MATERIALIZED (
       SELECT p.item_id, p.rate_idx, p.price_idx, p.negotiated_rate,
              t.tin_value AS ein, MIN(t.tin_type) AS tin_type, MIN(t.business_name) AS business_name
         FROM billing_items b
         JOIN negotiated_prices p ON p.item_id = b.item_id
         JOIN rate_provider_groups r ON r.item_id = p.item_id AND r.rate_idx = p.rate_idx
         JOIN provider_tins t ON t.provider_group_id = r.provider_group_id
        WHERE ${where.join(' AND ')}
        GROUP BY p.item_id, p.rate_idx, p.price_idx, t.tin_value
        ORDER BY ${keyCols.map((c) => `${c.expr} ${c.dir}`).join(', ')}
        LIMIT ?)
     ${RATE_ROW_SELECT}
      ORDER BY g.negotiated_rate ${rateDir}, g.item_id, g.rate_idx, g.price_idx, g.ein`,
    [...params, limit + 1],
  )
  const result = page(rows, limit, signature, (r) => [r.negotiated_rate, r.item_id, r.rate_idx, r.price_idx, r.ein])
  return {
    ...result,
    data: result.data.map(toRateRow),
  }
}

// GET /api/rates?limit=&cursor=   (every rate in file order; unfiltered and unsorted on purpose)
export async function rates(db: D1Database, q: Params) {
  const limit = parseLimit(q.get('limit'))
  const signature = JSON.stringify(['rates'])
  const cursor = decodeCursor(q.get('cursor'), signature, 4)
  const take = limit + 1
  const ks = cursor
    ? keysetWhere(
        ['item_id', 'rate_idx', 'price_idx', 'ein'].map((expr) => ({ expr, dir: 'ASC' as const })),
        cursor,
      )
    : null

  // `prices` walks the primary key and stops after limit + 2 entries. Each has at least one TIN, so
  // that always fills a page; the extra one covers the cursor's own price having no TINs left.
  const rows = await all(
    db,
    `WITH prices AS MATERIALIZED (
       SELECT p.item_id, p.rate_idx, p.price_idx, p.negotiated_rate
         FROM negotiated_prices p
        WHERE p.negotiated_rate IS NOT NULL
          ${cursor ? 'AND (p.item_id, p.rate_idx, p.price_idx) >= (?, ?, ?)' : ''}
          AND EXISTS (SELECT 1 FROM rate_provider_groups r
                        JOIN provider_tins t ON t.provider_group_id = r.provider_group_id
                       WHERE r.item_id = p.item_id AND r.rate_idx = p.rate_idx)
        ORDER BY p.item_id, p.rate_idx, p.price_idx
        LIMIT ?),
     page AS MATERIALIZED (
       SELECT * FROM (
         SELECT p.item_id, p.rate_idx, p.price_idx, p.negotiated_rate,
                t.tin_value AS ein, MIN(t.tin_type) AS tin_type, MIN(t.business_name) AS business_name
           FROM prices p
           JOIN rate_provider_groups r ON r.item_id = p.item_id AND r.rate_idx = p.rate_idx
           JOIN provider_tins t ON t.provider_group_id = r.provider_group_id
          GROUP BY p.item_id, p.rate_idx, p.price_idx, t.tin_value)
        ${ks ? `WHERE ${ks.sql}` : ''}
        ORDER BY item_id, rate_idx, price_idx, ein
        LIMIT ?)
     ${RATE_ROW_SELECT}
      ORDER BY g.item_id, g.rate_idx, g.price_idx, g.ein`,
    [...(cursor ? cursor.slice(0, 3) : []), take + 1, ...(ks?.params ?? []), take],
  )
  const result = page(rows, limit, signature, (r) => [r.item_id, r.rate_idx, r.price_idx, r.ein])
  return { ...result, data: result.data.map(toRateRow) }
}

const CHARGES_PAGE = 2000

// GET /api/charges?code=&limit=&cursor=   (every dollar rate per business for one code, for charts)
// Statistics need every row, so nothing is truncated: rows come in primary-key order, a page at a
// time, and clients follow next_cursor to the end. Item details come with the first page only.
// Revenue codes repeat one identical price list under hundreds of items, so a single item is read.
// `service` (additional_information) is what a revenue-code price is really for. 0001 tables only.
export async function charges(db: D1Database, q: Params) {
  const code = parseCode(q.get('code'))
  const item = await first(
    db,
    `SELECT b.item_id, b.billing_code, b.billing_code_type, b.name, b.description,
            (SELECT COUNT(*) FROM billing_items c WHERE c.billing_code = b.billing_code) AS item_count
       FROM billing_items b WHERE b.billing_code = ? ORDER BY b.item_id LIMIT 1`,
    [code],
  )
  if (!item) throw notFound()
  const limit = parseLimit(q.get('limit'), CHARGES_PAGE)
  const signature = JSON.stringify(['charges', code, item.item_id])
  const cursor = decodeCursor(q.get('cursor'), signature, 4)
  const ks = cursor
    ? keysetWhere(
        ['p.rate_idx', 'p.price_idx', 'r.provider_group_id', 't.tin_value'].map((expr) => ({ expr, dir: 'ASC' as const })),
        cursor,
      )
    : null

  const [rows, services] = await Promise.all([
    all(
      db,
      `SELECT p.rate_idx, p.price_idx, r.provider_group_id, t.business_name, t.tin_value AS ein,
              p.negotiated_rate, p.billing_class, p.service_code, p.billing_code_modifier,
              p.additional_information AS service
         FROM negotiated_prices p
         CROSS JOIN rate_provider_groups r ON r.item_id = p.item_id AND r.rate_idx = p.rate_idx
         CROSS JOIN provider_tins t ON t.provider_group_id = r.provider_group_id
        WHERE p.item_id = ? AND p.negotiated_rate IS NOT NULL AND p.negotiated_type IS NOT 'percentage'
          ${ks ? `AND (p.rate_idx, p.price_idx) >= (?, ?) AND ${ks.sql}` : ''}
        ORDER BY p.rate_idx, p.price_idx, r.provider_group_id, t.tin_value
        LIMIT ?`,
      [item.item_id, ...(cursor ? cursor.slice(0, 2) : []), ...(ks?.params ?? []), limit + 1],
    ),
    cursor
      ? Promise.resolve([])
      : all(
          db,
          `SELECT s.service, (SELECT b.name FROM billing_items b WHERE b.billing_code = s.service LIMIT 1) AS name
             FROM (SELECT DISTINCT additional_information AS service FROM negotiated_prices
                    WHERE item_id = ? AND additional_information IS NOT NULL) s`,
          [item.item_id],
        ),
  ])
  const result = page(rows, limit, signature, (r) => [r.rate_idx, r.price_idx, r.provider_group_id, r.ein])
  return {
    ...(cursor ? {} : { item, services }),
    ...result,
    data: result.data.map((r) => ({
      business_name: r.business_name,
      ein: r.ein,
      negotiated_rate: r.negotiated_rate,
      billing_class: r.billing_class,
      service: r.service,
      service_code: parseJson(r.service_code) ?? [],
      billing_code_modifier: parseJson(r.billing_code_modifier) ?? [],
    })),
  }
}

const BUSINESS_PAGE = 50 // billing codes per page, default and maximum; each is a bound parameter (D1 allows 100)

/** Median of an ascending list. */
const medianOf = (v: number[]) => (v[(v.length - 1) >> 1] + v[v.length >> 1]) / 2

/** A business's rate: a plain number, or the median of a JSON array of several. */
const ownRate = (v: unknown): number =>
  typeof v === 'number' ? v : medianOf((parseJson(v) as number[]).sort((a, b) => a - b))

// GET /api/business?name=&limit=&cursor=   (one business's rate per procedure against the median business)
// A procedure is an exact variant (code, priced service, place, modifier, class), so telehealth is
// never compared with office visits. Each business counts once, at the median of its own rates.
// Paged by billing code: the codes on the page are chosen first and only their market is aggregated,
// so a query's cost is bounded by `limit`, however large the business. Clients follow next_cursor.
// Reads one item per code, as in charges(). Medians are computed here, not with SQL window
// functions, which re-read every row several times against the D1 quota. 0001 tables only.
export async function business(db: D1Database, q: Params) {
  const name = q.get('name')?.trim() ?? ''
  if (!name || name.length > 200) throw badRequest(ERROR_CODES.MISSING_NAME)
  const limit = parseLimit(q.get('limit'), BUSINESS_PAGE)
  if (limit > BUSINESS_PAGE) throw badRequest(ERROR_CODES.INVALID_LIMIT)
  const signature = JSON.stringify(['business', name])
  const cursor = decodeCursor(q.get('cursor'), signature, 1)

  const identity = cursor
    ? null
    : await first(
        db,
        `SELECT MIN(business_name) AS name, COUNT(DISTINCT tin_value) AS ein_count
           FROM provider_tins WHERE business_name = ? COLLATE NOCASE`,
        [name],
      )
  if (identity && identity.ein_count === 0) throw notFound()

  // Unary + keeps SQLite on the (item_id, ...) key: one item per code, not its repeated copies.
  const items = await all(
    db,
    `SELECT c.item_id
       FROM (SELECT MIN(item_id) AS item_id FROM billing_items GROUP BY billing_code HAVING MIN(item_id) > ?) c
      WHERE EXISTS (SELECT 1 FROM rate_provider_groups r
                     WHERE r.item_id = c.item_id
                       AND +r.provider_group_id IN (SELECT provider_group_id FROM provider_tins
                                                     WHERE business_name = ? COLLATE NOCASE))
      ORDER BY c.item_id LIMIT ?`,
    [cursor?.[0] ?? -1, name, limit + 1],
  )
  const { data: pageItems, next_cursor } = page(items, limit, signature, (r) => [r.item_id])
  const head = { ...identity, limit, next_cursor }
  if (pageItems.length === 0) return { ...head, data: [] }

  // per_business.v is one rate, or a JSON array when a business has several for the same variant.
  // CROSS JOIN fixes the join order, starting from the page's items.
  const rows = await all(
    db,
    `WITH
     per_business AS (
       SELECT item_id, service, place, modifier, class, biz,
              CASE WHEN COUNT(*) = 1 THEN MIN(rate) ELSE json_group_array(rate) END AS v
         FROM (SELECT DISTINCT p.item_id, IFNULL(p.additional_information, '') AS service, IFNULL(p.service_code, '') AS place,
                      IFNULL(p.billing_code_modifier, '') AS modifier, IFNULL(p.billing_class, '') AS class,
                      LOWER(IFNULL(t.business_name, t.tin_value)) AS biz, p.negotiated_rate AS rate
                 FROM negotiated_prices p
                 CROSS JOIN rate_provider_groups r ON r.item_id = p.item_id AND r.rate_idx = p.rate_idx
                 CROSS JOIN provider_tins t ON t.provider_group_id = r.provider_group_id
                WHERE p.item_id IN (${pageItems.map(() => '?').join(',')})
                  AND p.negotiated_rate IS NOT NULL AND p.negotiated_type IS NOT 'percentage')
        GROUP BY item_id, service, place, modifier, class, biz),
     market AS (
       SELECT item_id, service, place, modifier, class, COUNT(*) AS businesses,
              json_group_array(v) AS rates, MAX(CASE WHEN biz = LOWER(?) THEN v END) AS own
         FROM per_business GROUP BY item_id, service, place, modifier, class
       HAVING own IS NOT NULL)
     SELECT m.service, m.place, m.modifier, m.class, m.businesses, m.rates, m.own,
            b.billing_code AS code, b.billing_code_type AS type, b.name,
            (SELECT s.name FROM billing_items s WHERE s.billing_code = m.service LIMIT 1) AS service_name
       FROM market m JOIN billing_items b ON b.item_id = m.item_id
      ORDER BY m.item_id, m.service, m.place, m.modifier, m.class`,
    [...pageItems.map((r) => r.item_id), name],
  )
  return {
    ...head,
    data: rows.map((r) => {
      const rates = (parseJson(r.rates) as unknown[]).map(ownRate).sort((a, b) => a - b)
      return {
        code: r.code,
        type: r.type,
        name: r.name,
        service: r.service || null,
        service_name: r.service_name,
        place: parseJson(r.place) ?? [],
        modifier: parseJson(r.modifier) ?? [],
        billing_class: r.class,
        rate: ownRate(r.own),
        median: medianOf(rates),
        low: rates[0],
        high: rates[rates.length - 1],
        businesses: r.businesses,
      }
    }),
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

// GET /api/providers?npi=&ein=&groups=&limit=   (groups: comma-separated provider_group_ids to narrow by)&cursor=
export async function providers(db: D1Database, q: Params) {
  const npi = parseNpi(q.get('npi'))
  const ein = parseEin(q.get('ein') ?? q.get('tin'))
  if (npi === undefined && ein === undefined) throw badRequest(ERROR_CODES.MISSING_FILTER)
  const limit = parseLimit(q.get('limit'))
  const groups = parseGroups(q.get('groups'))
  const signature = JSON.stringify(['providers', npi, ein, groups])
  const cursor = decodeCursor(q.get('cursor'), signature, 2)

  const where: string[] = []
  const params: unknown[] = []
  if (npi !== undefined) (where.push('n.npi = ?'), params.push(npi))
  if (ein !== undefined) (where.push('n.tin_value IN (?, ?)'), params.push(...einForms(ein)))
  if (groups) (where.push(`n.provider_group_id IN (${groups.map(() => '?').join(',')})`), params.push(...groups))
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
    `SELECT MIN(tin_value) AS tin_value, MIN(business_name) AS business_name, COUNT(DISTINCT provider_group_id) AS group_count
       FROM provider_tins WHERE tin_value IN (?, ?)`,
    einForms(ein),
  )
  if (!info || info.group_count === 0) throw notFound()
  const rates = await entityRates(
    db,
    'org',
    `SELECT provider_group_id FROM provider_tins WHERE tin_value = ?`,
    info.tin_value,
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
