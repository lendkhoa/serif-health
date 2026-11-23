import { notifications } from '@mantine/notifications'
import {
  API_ERROR_MESSAGES,
  ERROR_TOAST_TITLES,
  HTTP_STATUS_MESSAGES,
  NETWORK_ERROR_MESSAGE,
  TIMEOUT_MESSAGE,
  UNEXPECTED_RESPONSE_MESSAGE,
  UNKNOWN_ERROR_MESSAGE,
} from './constants/apiErrors'

export class ApiRequestError extends Error {
  readonly status: number // 0 = network failure
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

type Query = Record<string, string | number | undefined | null>

const REQUEST_TIMEOUT_MS = 30_000

/**
 * GET a JSON endpoint. Throws ApiRequestError with a user-friendly message on any failure,
 * including timeouts. If the caller aborts `signal`, the abort error is rethrown untouched.
 */
export async function apiGet<T>(path: string, query: Query = {}, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()

  let response: Response
  try {
    response = await fetch(qs ? `${path}?${qs}` : path, { signal: combined })
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
    throw new ApiRequestError(message, response.status, code)
  }
  return body as T
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
