import { notifications } from '@mantine/notifications'
import {
  API_ERROR_MESSAGES,
  ERROR_TOAST_TITLES,
  HTTP_STATUS_MESSAGES,
  NETWORK_ERROR_MESSAGE,
  TIMEOUT_MESSAGE,
  TOO_MANY_ROWS_MESSAGE,
  UNEXPECTED_RESPONSE_MESSAGE,
  UNKNOWN_ERROR_MESSAGE,
} from './constants/apiErrors'

export class ApiRequestError extends Error {
  readonly status: number // 0 = network failure
  readonly code?: string
  readonly details: string[]

  constructor(message: string, status: number, code?: string, details: string[] = []) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

type Query = Record<string, string | number | undefined | null>

const REQUEST_TIMEOUT_MS = 30_000

/**
 * GET a JSON endpoint. Throws ApiRequestError with a user-friendly message on any failure,
 * including timeouts. If the caller aborts `signal`, the abort error is rethrown untouched.
 */
export async function apiGet<T>(path: string, query: Query = {}, signal?: AbortSignal): Promise<T> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return request<T>(qs ? `${path}?${qs}` : path, { cache: 'no-store' }, REQUEST_TIMEOUT_MS, signal)
}

/** POST JSON. Fails the same way as apiGet. */
export function apiPost<T>(path: string, body: unknown, signal?: AbortSignal, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  return request<T>(path, init, timeoutMs, signal)
}

async function request<T>(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: combined })
  } catch (error) {
    if (signal?.aborted) throw error
    if (timeout.aborted) throw new ApiRequestError(TIMEOUT_MESSAGE, 0)
    throw new ApiRequestError(NETWORK_ERROR_MESSAGE, 0)
  }

  let body: any
  try {
    body = await response.json()
  } catch (error) {
    if (signal?.aborted) throw error
    if (timeout.aborted) throw new ApiRequestError(TIMEOUT_MESSAGE, 0)
    throw new ApiRequestError(
      response.ok ? UNEXPECTED_RESPONSE_MESSAGE : (HTTP_STATUS_MESSAGES[response.status] ?? UNKNOWN_ERROR_MESSAGE),
      response.status,
    )
  }

  if (!response.ok) {
    const code: string | undefined = body?.error?.code
    const message =
      (code && API_ERROR_MESSAGES[code]) ?? HTTP_STATUS_MESSAGES[response.status] ?? UNKNOWN_ERROR_MESSAGE
    throw new ApiRequestError(message, response.status, code, Array.isArray(body?.error?.details) ? body.error.details : [])
  }
  return body as T
}

const MAX_PAGES = 100 // stops a runaway loop; real lists take a handful

/**
 * Follow next_cursor to the end, one request at a time. Charts need every row, so this either
 * returns all of them (with the first page's other fields) or throws; it never returns a subset.
 */
export async function apiGetAll<T extends { data: unknown[]; next_cursor: string | null }>(
  path: string,
  query: Query,
  signal?: AbortSignal,
): Promise<T> {
  const first = await apiGet<T>(path, query, signal)
  const data = [...first.data]
  let cursor = first.next_cursor
  for (let pages = 1; cursor; pages++) {
    if (pages >= MAX_PAGES) throw new ApiRequestError(TOO_MANY_ROWS_MESSAGE, -1)
    const next: T = await apiGet<T>(path, { ...query, cursor }, signal)
    data.push(...next.data)
    cursor = next.next_cursor
  }
  return { ...first, data, next_cursor: null }
}

/** Show a toast for any error thrown while calling the API. */
export function notifyApiError(error: unknown) {
  const err =
    error instanceof ApiRequestError ? error : new ApiRequestError(UNKNOWN_ERROR_MESSAGE, -1)
  const isServer = err.status >= 500
  const isNetwork = err.status === 0
  const isNotFound = err.status === 404

  notifications.show({
    title: isNetwork
      ? ERROR_TOAST_TITLES.network
      : isServer
        ? ERROR_TOAST_TITLES.server
        : isNotFound
          ? ERROR_TOAST_TITLES.notFound
          : ERROR_TOAST_TITLES.validation,
    message: err.message,
    color: isNotFound ? 'yellow' : 'red',
    autoClose: isServer || isNetwork ? 8000 : 5000,
  })
}

/** apiGet + toast on failure. Still rethrows so callers can reset their own state. */
export async function apiGetWithToast<T>(path: string, query?: Query): Promise<T> {
  try {
    return await apiGet<T>(path, query)
  } catch (error) {
    notifyApiError(error)
    throw error
  }
}
