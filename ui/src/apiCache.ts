import { useSyncExternalStore } from 'react'

/**
 * In-memory response cache shared by every lens, bounded by entry count and age.
 *
 * Invalidation after an ingest: entries expire after TTL_MS, a page reload starts empty, and
 * clearApiCache() (the "Refresh data" button) drops everything and makes visible lenses refetch.
 * HTTP caching stays off (the API sends no-store), so nothing can outlive these rules.
 */
const TTL_MS = 10 * 60_000
const MAX_ENTRIES = 40

const entries = new Map<string, { data: unknown; at: number }>()
const listeners = new Set<() => void>()
let version = 0

export function getCached<T>(key: string): T | undefined {
  const entry = entries.get(key)
  return entry && Date.now() - entry.at < TTL_MS ? (entry.data as T) : undefined
}

/** `startedIn` is the version the request began in; a response from before a refresh is not stored. */
export function setCached(key: string, data: unknown, startedIn: number) {
  if (startedIn !== version) return
  entries.delete(key)
  entries.set(key, { data, at: Date.now() })
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!)
}

export function clearApiCache() {
  entries.clear()
  version++
  listeners.forEach((notify) => notify())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** Changes whenever the cache is cleared; use it as an effect dependency to refetch. */
export const useCacheVersion = () => useSyncExternalStore(subscribe, () => version)
