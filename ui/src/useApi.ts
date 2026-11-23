import { useCallback, useEffect, useState } from 'react'
import { notifyApiError } from './api.ts'
import { getCached, setCached, useCacheVersion } from './apiCache.ts'

const DEBOUNCE_MS = 150 // coalesces StrictMode's double effect into one request

/**
 * Cached, cancellable load of `param`; an empty param stays idle. `load` must be a stable function
 * and `scope` unique to it. `data` is null while loading or after a failure. Failures aren't cached.
 */
export function useApi<T>(scope: string, param: string, load: (param: string, signal: AbortSignal) => Promise<T>) {
  const [result, setResult] = useState<{ key: string; version: number; data: T | null } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const version = useCacheVersion()
  const key = `${scope}|${param}`

  useEffect(() => {
    if (!param) return
    const cached = getCached<T>(key)
    if (cached) {
      setResult({ key, version, data: cached })
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      load(param, controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return
          setCached(key, data, version)
          setResult({ key, version, data })
        })
        .catch((error) => {
          if (controller.signal.aborted) return
          notifyApiError(error)
          setResult({ key, version, data: null })
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [key, param, load, version, attempt])

  const retry = useCallback(() => {
    setResult(null)
    setAttempt((n) => n + 1)
  }, [])
  const current = result?.key === key && result.version === version ? result : null
  return { data: current?.data ?? null, loading: param !== '' && !current, retry }
}
