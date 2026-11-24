/** User-facing API error messages. Keys of API_ERROR_MESSAGES match the API's `error.code`. */
export const API_ERROR_MESSAGES: Record<string, string> = {
  MISSING_CODE: 'Enter a billing code to search.',
  INVALID_CODE: 'Billing codes are 1-20 letters or digits, e.g. 99213, J1745 or 0001U.',
  INVALID_NPI: 'NPI must be exactly 10 digits.',
  INVALID_EIN: 'EIN must be exactly 9 digits (dashes are fine).',
  INVALID_GROUPS: 'Those provider groups could not be looked up.',
  INVALID_LIMIT: 'Page size must be between 1 and 500.',
  INVALID_CURSOR: 'Your results page expired. Please run the search again.',
  INVALID_SORT: 'Unsupported sort order.',
  MISSING_NAME: 'Enter a business name.',
  MISSING_FILTER: 'Enter an NPI or an EIN.',
  MISSING_QUERY: 'Type something to search for.',
  QUERY_TOO_LONG: 'Search text must be 200 characters or fewer.',
  INVALID_JSON: 'That is not valid JSON.',
  INVALID_PLAN: 'Some plan details are missing or not valid.',
  BODY_TOO_LARGE: 'That input is too large.',
  NOT_FOUND: 'Nothing was found for that request.',
  ROUTE_NOT_FOUND: 'That API endpoint does not exist.',
  METHOD_NOT_ALLOWED: 'That request type is not supported.',
  AI_OFFLINE: 'The AI is offline. Prices and charts still work without it.',
  AI_BAD_REPLY: 'The AI gave an unusable answer. Please try again.',
  DB_ERROR: 'The database could not be queried. Please try again.',
  INTERNAL: 'Something went wrong on our side. Please try again.',
}

/** Fallbacks by HTTP status when the response has no recognised error code. */
export const HTTP_STATUS_MESSAGES: Record<number, string> = {
  400: 'The request was not valid.',
  404: 'Nothing was found for that request.',
  429: 'Too many requests. Please wait a moment.',
  500: 'Something went wrong on our side. Please try again.',
  502: 'The API is temporarily unavailable.',
  503: 'The API is temporarily unavailable.',
}

export const TOO_MANY_ROWS_MESSAGE = 'There are too many rates to chart accurately.'
export const TIMEOUT_MESSAGE = 'The API took too long to respond. Add a filter or try again.'
export const NETWORK_ERROR_MESSAGE = 'Could not reach the API. Check your connection and try again.'
export const UNEXPECTED_RESPONSE_MESSAGE = 'The API returned an unexpected response.'
export const UNKNOWN_ERROR_MESSAGE = 'An unexpected error occurred.'

export const ERROR_TOAST_TITLES = {
  validation: 'Check your input',
  notFound: 'No results',
  server: 'Server error',
  network: 'Connection problem',
} as const
