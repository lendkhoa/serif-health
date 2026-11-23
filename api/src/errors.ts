/** Stable machine-readable error codes returned by the API. The UI maps these to toasts. */
export const ERROR_CODES = {
  MISSING_CODE: 'MISSING_CODE',
  INVALID_CODE: 'INVALID_CODE',
  INVALID_NPI: 'INVALID_NPI',
  INVALID_EIN: 'INVALID_EIN',
  INVALID_LIMIT: 'INVALID_LIMIT',
  INVALID_CURSOR: 'INVALID_CURSOR',
  INVALID_SORT: 'INVALID_SORT',
  MISSING_FILTER: 'MISSING_FILTER',
  MISSING_QUERY: 'MISSING_QUERY',
  NOT_FOUND: 'NOT_FOUND',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  DB_ERROR: 'DB_ERROR',
  INTERNAL: 'INTERNAL',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  MISSING_CODE: 'Query parameter "code" (billing code) is required.',
  INVALID_CODE: 'Billing code must be 1-20 letters or digits, e.g. 99213, J1745 or 0001U.',
  INVALID_NPI: 'NPI must be exactly 10 digits.',
  INVALID_EIN: 'EIN/TIN must be exactly 9 digits (dashes are ignored).',
  INVALID_LIMIT: 'Limit must be an integer between 1 and 500.',
  INVALID_CURSOR: 'The pagination cursor is invalid. Restart the search without a cursor.',
  INVALID_SORT: 'Sort must be one of: rate_desc, rate_asc.',
  MISSING_FILTER: 'Provide at least one of "npi" or "ein".',
  MISSING_QUERY: 'Query parameter "q" is required.',
  NOT_FOUND: 'No data was found for the requested resource.',
  ROUTE_NOT_FOUND: 'Unknown API route.',
  METHOD_NOT_ALLOWED: 'Only GET requests are supported.',
  DB_ERROR: 'The database could not be queried. Please try again.',
  INTERNAL: 'Unexpected server error.',
}

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string = ERROR_MESSAGES[code],
  ) {
    super(message)
  }
}

export const badRequest = (code: ErrorCode) => new ApiError(code, 400)
export const notFound = (code: ErrorCode = ERROR_CODES.NOT_FOUND) => new ApiError(code, 404)

export function errorResponse(err: ApiError): Response {
  return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status })
}
