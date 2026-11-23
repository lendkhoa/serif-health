import { ERROR_CODES, badRequest } from './errors'

export const DEFAULT_LIMIT = 100
export const MAX_LIMIT = 500
export const MAX_GROUPS = 25

export function parseCode(raw: string | null): string {
  const value = raw?.trim() ?? ''
  if (!value) throw badRequest(ERROR_CODES.MISSING_CODE)
  if (!/^[A-Za-z0-9]{1,20}$/.test(value)) throw badRequest(ERROR_CODES.INVALID_CODE)
  return value.toUpperCase() // keeps leading zeros / alphanumerics (0001U, J1745)
}

export function parseNpi(raw: string | null): number | undefined {
  const value = raw?.trim()
  if (!value) return undefined
  if (!/^\d{10}$/.test(value)) throw badRequest(ERROR_CODES.INVALID_NPI)
  return Number(value)
}

/** EIN/TIN normalised to digits only. Use einForms() to match it against stored values. */
export function parseEin(raw: string | null): string | undefined {
  const value = raw?.trim().replace(/-/g, '')
  if (!value) return undefined
  if (!/^\d{9}$/.test(value)) throw badRequest(ERROR_CODES.INVALID_EIN)
  return value
}

/** Files publish EINs both ways ("123456789" and "12-3456789"); match either, using the index. */
export const einForms = (ein: string): [string, string] => [ein, `${ein.slice(0, 2)}-${ein.slice(2)}`]

export function parseGroups(raw: string | null): number[] | undefined {
  if (!raw) return undefined
  const ids = raw.split(',')
  if (ids.length > MAX_GROUPS || !ids.every((id) => /^\d{1,15}$/.test(id))) {
    throw badRequest(ERROR_CODES.INVALID_GROUPS)
  }
  return ids.map(Number)
}

export function parseLimit(raw: string | null, fallback = DEFAULT_LIMIT): number {
  if (raw === null || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) throw badRequest(ERROR_CODES.INVALID_LIMIT)
  return n
}

export type Sort = 'rate_desc' | 'rate_asc'
export function parseSort(raw: string | null): Sort {
  if (raw === null || raw === '') return 'rate_desc'
  if (raw !== 'rate_desc' && raw !== 'rate_asc') throw badRequest(ERROR_CODES.INVALID_SORT)
  return raw
}

/**
 * Cursors are opaque base64url JSON arrays: [signature, ...last row's sort key]. The signature
 * identifies the query (filters + sort), so a cursor cannot be replayed against a different one.
 */
export function encodeCursor(signature: string, key: unknown[]): string {
  return btoa(JSON.stringify([signature, ...key]))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function decodeCursor(raw: string | null, signature: string, length: number): unknown[] | undefined {
  if (!raw) return undefined
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/')
    const parts = JSON.parse(atob(b64))
    const ok =
      Array.isArray(parts) &&
      parts.length === length + 1 &&
      parts[0] === signature &&
      parts.slice(1).every((v) => typeof v === 'string' || typeof v === 'number')
    if (ok) return parts.slice(1)
  } catch {
    // fall through
  }
  throw badRequest(ERROR_CODES.INVALID_CURSOR)
}

/**
 * Builds a keyset-pagination condition `key > cursor` for a mixed-direction ordering,
 * expanded to OR form so SQLite can use indexes. Returns the SQL and its bind params.
 */
export function keysetWhere(
  cols: { expr: string; dir: 'ASC' | 'DESC' }[],
  cursor: unknown[],
): { sql: string; params: unknown[] } {
  const ors: string[] = []
  const params: unknown[] = []
  cols.forEach((col, i) => {
    const eqs = cols.slice(0, i).map((c) => `${c.expr} = ?`)
    ors.push([...eqs, `${col.expr} ${col.dir === 'ASC' ? '>' : '<'} ?`].join(' AND '))
    params.push(...cursor.slice(0, i), cursor[i])
  })
  return { sql: `(${ors.map((o) => `(${o})`).join(' OR ')})`, params }
}
