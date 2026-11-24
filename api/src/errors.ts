/** Stable machine-readable error codes returned by the API. The UI maps these to toasts. */
export const ERROR_CODES = {
  MISSING_CODE: 'MISSING_CODE',
  INVALID_CODE: 'INVALID_CODE',
  INVALID_NPI: 'INVALID_NPI',
  INVALID_EIN: 'INVALID_EIN',
  INVALID_GROUPS: 'INVALID_GROUPS',
  INVALID_LIMIT: 'INVALID_LIMIT',
  INVALID_CURSOR: 'INVALID_CURSOR',
  INVALID_SORT: 'INVALID_SORT',
  MISSING_NAME: 'MISSING_NAME',
  MISSING_FILTER: 'MISSING_FILTER',
  MISSING_QUERY: 'MISSING_QUERY',
  QUERY_TOO_LONG: 'QUERY_TOO_LONG',
  INVALID_JSON: 'INVALID_JSON',
  INVALID_PLAN: 'INVALID_PLAN',
  MISSING_CONTEXT: 'MISSING_CONTEXT',
  BODY_TOO_LARGE: 'BODY_TOO_LARGE',
  NOT_FOUND: 'NOT_FOUND',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  AI_OFFLINE: 'AI_OFFLINE',
  AI_BAD_REPLY: 'AI_BAD_REPLY',
  DB_ERROR: 'DB_ERROR',
  INTERNAL: 'INTERNAL',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  MISSING_CODE: 'Query parameter "code" (billing code) is required.',
  INVALID_CODE: 'Billing code must be 1-20 letters or digits, e.g. 99213, J1745 or 0001U.',
  INVALID_NPI: 'NPI must be exactly 10 digits.',
  INVALID_EIN: 'EIN/TIN must be exactly 9 digits (dashes are ignored).',
  INVALID_GROUPS: 'Groups must be 1-25 comma-separated provider group ids.',
  INVALID_LIMIT: 'Limit must be an integer between 1 and 500.',
  INVALID_CURSOR: 'The pagination cursor is invalid. Restart the search without a cursor.',
  INVALID_SORT: 'Sort must be one of: rate_desc, rate_asc.',
  MISSING_NAME: 'Query parameter "name" (business name, up to 200 characters) is required.',
  MISSING_FILTER: 'Provide at least one of "npi" or "ein".',
  MISSING_QUERY: 'Query parameter "q" is required.',
  QUERY_TOO_LONG: 'Query parameter "q" must be at most 200 characters.',
  INVALID_JSON: 'The request body must be valid JSON.',
  INVALID_PLAN: 'The plan is not valid. See "details" for each problem.',
  MISSING_CONTEXT: 'The message must include the plan and procedures as one valid JSON object.',
  BODY_TOO_LARGE: 'The request body is too large.',
  NOT_FOUND: 'No data was found for the requested resource.',
  ROUTE_NOT_FOUND: 'Unknown API route.',
  METHOD_NOT_ALLOWED: 'This route does not support that request method.',
  AI_OFFLINE: 'The AI is offline. Prices and charts still work without it.',
  AI_BAD_REPLY: 'The AI gave an unusable answer. Please try again.',
  DB_ERROR: 'The database could not be queried. Please try again.',
  INTERNAL: 'Unexpected server error.',
}

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string = ERROR_MESSAGES[code],
    readonly details?: string[],
  ) {
    super(message)
  }
}

export const badRequest = (code: ErrorCode) => new ApiError(code, 400)
export const notFound = (code: ErrorCode = ERROR_CODES.NOT_FOUND) => new ApiError(code, 404)

export function errorResponse(err: ApiError): Response {
  const { code, message, details, status } = err
  return Response.json({ error: { code, message, ...(details && { details }) } }, { status })
}
