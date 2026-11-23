import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, notifyApiError } from '../api.ts'
import type { Page, RateFilters, RateRow, RateSort } from './types.ts'

const DEBOUNCE_MS = 150 // coalesces rapid changes (and StrictMode's double effect) into one request
const MAX_CACHED_PAGES = 20

export type RatesQuery = { filters: RateFilters; sort: RateSort; limit: number }

/**
 * Cursor-paginated /api/search. Only the visible page is requested, nothing is prefetched or
 * retried automatically, and a superseded request is aborted. Recent pages are kept in a small
 * cache so going back costs the server nothing.
 */
export function useRates(query: RatesQuery) {
  const { filters, sort, limit } = query
  const queryKey = JSON.stringify([filters, sort, limit])

  // cursors[i] opens page i. Reset during render when the query changes, so a cursor from the
  // previous query is never sent with the new one.
  const [paging, setPaging] = useState({ queryKey, cursors: [null] as (string | null)[], page: 0 })
  const [result, setResult] = useState<{ key: string; data: Page<RateRow> | null; error: boolean } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const cache = useRef(new Map<string, Page<RateRow>>())

  if (paging.queryKey !== queryKey) setPaging({ queryKey, cursors: [null], page: 0 })

  const cursor = paging.cursors[paging.page]
  const key = `${queryKey}|${cursor ?? ''}`
  const enabled = filters.code !== ''

  useEffect(() => {
    if (!enabled) return
    const cached = cache.current.get(key)
    if (cached) {
      setResult({ key, data: cached, error: false })
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const [f, s, l] = JSON.parse(queryKey) as [RateFilters, RateSort, number]
        const data = await apiGet<Page<RateRow>>(
          '/api/search',
          { code: f.code, npi: f.npi, ein: f.ein, setting: f.setting, class: f.billingClass, sort: s, limit: l, cursor },
          controller.signal,
        )
        if (controller.signal.aborted) return
        cache.current.set(key, data)
        if (cache.current.size > MAX_CACHED_PAGES) cache.current.delete(cache.current.keys().next().value!)
        setResult({ key, data, error: false })
      } catch (error) {
        if (controller.signal.aborted) return
        notifyApiError(error)
        setResult({ key, data: null, error: true })
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [enabled, key, queryKey, cursor, attempt])

  const current = result?.key === key ? result : null
  const loading = enabled && !current
  const nextCursor = current?.data?.next_cursor ?? null

  const next = useCallback(() => {
    if (!nextCursor) return
    setPaging((p) => ({ ...p, cursors: [...p.cursors.slice(0, p.page + 1), nextCursor], page: p.page + 1 }))
  }, [nextCursor])
  const previous = useCallback(() => setPaging((p) => ({ ...p, page: Math.max(0, p.page - 1) })), [])
  const firstPage = useCallback(() => setPaging((p) => ({ ...p, page: 0 })), [])
  const retry = useCallback(() => {
    setResult(null)
    setAttempt((n) => n + 1)
  }, [])

  return {
    // Keep the old rows under the loading overlay rather than flashing an empty table.
    rows: enabled ? ((current ?? (loading ? result : null))?.data?.data ?? []) : [],
    loading,
    failed: current?.error ?? false,
    page: paging.page,
    hasNext: nextCursor !== null,
    next,
    previous,
    firstPage,
    retry,
  }
}
