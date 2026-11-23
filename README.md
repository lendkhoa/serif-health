# Serif Health
## Price Transparency Explorer
[Demo App](https://serif-health-assignment.khoale.workers.dev/app)

A small full-stack app for searching an insurer's negotiated rates by billing code.

## Goal

I take a CMS Transparency in Coverage index file (Centene / Fidelis), use it to pick an in-network rate file, and make that file searchable.

1. **Index**: Find an in-network rate file URL in the index.
2. **Ingest**: Fetch the rate file and flatten its nested JSON into simple rows: billing code, description, provider NPI/EIN, negotiated rate, and source file.
3. **API**: `GET /search?code=<billing_code>&npi=<npi>&ein=<ein>`. The billing code is required; NPI and EIN are optional filters.
4. **UI**: Search by billing code, narrow by NPI/EIN, and view the results in a clean table.
5. **Resilience**: Show fetch and parse errors in the UI instead of crashing.

## Scope

- Data is kept in memory, with no database.
- The rate file is picked by hand from the index.
- I timeboxed the work to about 3 hours.

## Setup

_Coming soon._

# Timeline
2026-11-22 Setup scaffold, backend and ui
![setup-project](./assets/2026-11-22.png)

## Understanding the structure
Each JSON file is very large so the first step is understanding the key paths and the schema skeleton of the file.
→ Add `make explain-file` command to print out the unique key paths
```txt
➜  serif-health git:(main) ✗ make explain-file FILE=/path/2026-08-31_centene-management-company-llc_fidelis-es_in-network.json
in_network[].billing_code: string
in_network[].billing_code_type: string
in_network[].billing_code_type_version: string
in_network[].description: string
in_network[].name: string
in_network[].negotiated_rates[].negotiated_prices[].additional_information: string
in_network[].negotiated_rates[].negotiated_prices[].billing_class: string
in_network[].negotiated_rates[].negotiated_prices[].billing_code_modifier[]: string
in_network[].negotiated_rates[].negotiated_prices[].expiration_date: string
in_network[].negotiated_rates[].negotiated_prices[].negotiated_rate: number
in_network[].negotiated_rates[].negotiated_prices[].negotiated_type: string
in_network[].negotiated_rates[].negotiated_prices[].service_code[]: string
in_network[].negotiated_rates[].negotiated_prices[].setting: string
in_network[].negotiated_rates[].provider_references[]: number
in_network[].negotiation_arrangement: string
last_updated_on: string
provider_references[].network_name: array
provider_references[].provider_group_id: number
provider_references[].provider_groups[].npi[]: number
provider_references[].provider_groups[].tin.business_name: string
provider_references[].provider_groups[].tin.type: string
provider_references[].provider_groups[].tin.value: string
reporting_entity_name: string
reporting_entity_type: string
version: string

```

→ In-memory won't scale. A 176MB, 3.3M-line JSON file becomes roughly 1–2GB of Python objects. Loading it into memory is slow and gets re-done every session. A persisted, indexed store is better.

## Makefile
### Make help
```bash
➜  serif-health git:(main) ✗ make help
Targets:
  install  Install API and UI dependencies (use Node 22: nvm use)
  dev      Run the Workers API (:8787) and the React UI with hot reload
  deploy   Build the UI and deploy the Worker (serves API + UI)
  explain-file  Print unique key paths of a large JSON file (FILE=path/to.json)
  d1-migrate  Apply api/migrations to D1 (add LOCAL=1 for local)
  migrate-file-to-d1  Load a big JSON file into D1 (FILE=path [LIMIT_ITEMS=n] [LIMIT_PROVIDERS=n] [START_ITEM=n] [LOCAL=1])
  nuke-dev-db  Delete ALL rows from the D1 tables, keeping the schema (LOCAL=1 for local; CONFIRM=yes skips the prompt)
  help     Show this help message
```

### Migrate the downloaded JSON to D1 sqlite database
```bash
serif-health git:(main) ✗ make migrate-file-to-d1 FILE=/<PATH>2026-08-31_centene-management-company-llc_fidelis-es_in-network.json
Providers (provider_references[])
  groups: 1908 (86/s)))
Billing items (in_network[])
  items: 2530 (11/s)
  last item_id processed: 2529
Done in 243s, 73 batches.
```


## API design

### Endpoints
| API | Note |
|---|---|
| `GET /api/health` | Liveness check. |
| `GET /api/search?code=&npi=&tin=&setting=&class=&sort=&limit=&cursor=` | Main search. `code` is required (exact billing code); `npi`, `tin`, `setting`, `class` are optional filters. Keyset-paginated (`limit` default 100, max 500) with an opaque cursor that includes the sort key. Returns `data` and `next_cursor`, with no `COUNT(*)`. |
| `GET /api/summary?code=` | Context for a code: median, P25–P75, min–max, provider/org counts, histogram buckets, and breakdown by setting / billing class / negotiated type. Served from a precomputed `code_summary`. Feeds the KPI strip and charts. |
| `GET /api/suggest?q=` | Omnibox autocomplete. Classifies the input (code, NPI, TIN, free text) and returns grouped matches (codes, organisations, providers) with counts. Free text uses FTS5 over descriptions and business names. |
| `GET /api/codes/:code` | Billing-code metadata (type, name, descriptions) without expanding rates or providers. |
| `GET /api/providers?npi=&tin=&limit=&cursor=` | Provider identity lookup: NPIs and the TINs they belong to. Also used to narrow the main search. |
| `GET /api/org/:tin` | Organisation view: codes the TIN is priced on, with its rate vs. the market median per code. |
| `GET /api/provider/:npi` | Provider view: the TINs for an NPI and its rates per code. |

### Query strategy
- **Pick the entry point by filter.** Start from the most selective indexed side:
  - `npi` + `tin`: `provider_npis` filtered by both (most selective, preferred).
  - `npi` only: `provider_npis → rate_provider_groups → negotiated_prices → billing_items → provider_tins`.
  - `tin` only: `provider_tins → provider_npis → rate_provider_groups → negotiated_prices → billing_items`.
  - code only: `billing_items (billing_code) → negotiated_prices → …`, always paginated.
- **Keyset pagination, never `OFFSET`.** Order by a deterministic key and page with `WHERE (k1, k2, …) > (?, ?, …)`. The cursor is an opaque, validated base64url JSON object. For rate-sorted views the key is `(negotiated_rate DESC, <unique tiebreaker>)`.
- **`limit + 1` instead of `COUNT(*)`.** Fetch one extra row to decide whether a next page exists, and return `next_cursor` only then. Approximate totals come from `code_summary`.
- **Move join cost to ingest.** The 5-way join fans out (one rate entry × provider groups × TINs × NPIs). Build a denormalised `rates_flat` (code, TIN, business name, rate, setting, class, type, expiration, NPI count) with indexes `(billing_code, negotiated_rate DESC, id)` and `(tin_value, billing_code)`, so search, sorting and the org/provider views are single indexed range scans.
- **One row per (TIN, rate) for the UI.** Return an NPI count and expand NPIs on demand. Return per-NPI rows only when the caller filters by `npi`.
- **Covering indexes.** `provider_npis (npi, provider_group_id, tin_value)` and `provider_tins (tin_value, provider_group_id)`; `billing_items (billing_code, item_id)`.
- **Precompute summaries.** Data is immutable per source file, so percentiles, histogram buckets and counts are computed at ingest into `code_summary` and cached at the edge.
- **Provenance.** Add a `source_files` table and a `source_file_id` reference so every row can report its source file.
- **Guardrails.** Cap `limit`, warn when a code-only result set is very large, normalise TIN (strip dashes), and dedupe rows that arise via multiple `provider_references`.
- **Verify, then optimise.** Run `EXPLAIN QUERY PLAN` on each branch against the real data. Row-value keyset comparisons may need expanding to `OR` conditions if the planner skips the index.
