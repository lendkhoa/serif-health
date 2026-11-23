/** One row of GET /api/search: a negotiated price for one TIN. */
export type RateRow = {
  billing_code: string
  billing_code_type: string | null
  billing_code_type_version: string | null
  name: string | null
  description: string | null
  negotiation_arrangement: string | null
  negotiated_rate: number
  negotiated_type: string | null
  billing_class: string | null
  setting: string | null
  expiration_date: string | null
  additional_information: string | null
  service_code: string[] | null
  billing_code_modifier: string[] | null
  source_file: string | null
  source_file_url: string | null
  source_last_updated_on: string | null
  item_id: number
  rate_idx: number
  price_idx: number
  ein: string
  tin_type: string | null
  business_name: string | null
  npi_count: number
  npis: number[] // preview; see npi_count for the total
  provider_group_ids: number[]
}

export type Page<T> = { data: T[]; next_cursor: string | null; limit: number }

export type RateSort = 'rate_desc' | 'rate_asc'

export type RateFilters = {
  code: string
  npi: string
  ein: string
  setting: string | null
  billingClass: string | null
}

export const EMPTY_FILTERS: RateFilters = { code: '', npi: '', ein: '', setting: null, billingClass: null }

export const rowId = (r: RateRow) => `${r.item_id}-${r.rate_idx}-${r.price_idx}-${r.ein}`
