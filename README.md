# Serif Health: Price Transparency Explorer

[Demo app](https://serif-health-assignment.khoale.workers.dev/app)

A full-stack app for exploring an insurer's negotiated rates, built on a CMS Transparency in Coverage file from Centene / Fidelis.

- **Explore data**
  - **All rates:** browse every rate, or search a billing code and narrow it by NPI, EIN, setting and billing class.
  - **Compare businesses:** chart what each business is paid for one code.
  - **One business:** a business's rates against the median, per code.
- **Price AI:** recommends in-network providers for an employer's plan and expected use, with estimated savings and where the data is too thin to decide. Prices, rankings and savings are computed; a model only writes the summary.

## Quick start

Requires Node 22.12 or later (`nvm use`). Loading a rate file also needs Python 3 and [`jq`](https://jqlang.org).

```bash
make install
make d1-migrate LOCAL=1
# Download the rate file (see Data source), then:
make migrate-file-to-d1 LOCAL=1 FILE=path/to/in-network.json SOURCE_URL='https://...' LAST_UPDATED_ON=2026-08-31
make build-summaries LOCAL=1
make dev    # UI on http://localhost:5173, API on :8787
```

`LOCAL=1` uses a local D1 database; leave it out to use the remote one. The AI bindings in `api/wrangler.jsonc` run on Cloudflare even during local development, so run `npx wrangler login` first. The VPC Service id there belongs to this project's account: replace it with your own, or remove `vpc_services`.

- `npm test -w api` runs the API tests and `npm run typecheck -w api` checks its types.
- `make deploy` builds the UI and deploys one Worker that serves both.
- `make help` lists every command.

## Architecture

```
Centene index -> rate file (JSON) -> scripts/migrate_file.py -> D1
                                                                |
                            React UI  <->  Worker API (/api/*) -+
                                                |
                             Ollama (VPC Service + Tunnel) -> Workers AI fallback
```

| Path | Contents |
|---|---|
| `api/` | Cloudflare Worker, D1 migrations and tests |
| `ui/` | React, Mantine and MUI X Chat, built with Vite |
| `scripts/` | Schema explorer, streaming ingest and summary SQL |
| `samples/price-ai/` | Example Price AI inputs |

## Data source

The [index](https://www.centene.com/content/dam/centene/Centene%20Corporate/json/DOCUMENT/2026-08-31_fidelis_index.json) lists two in-network files, `fidelis-es` and `fidelis-ex`. The app uses [`fidelis-es`](https://www.centene.com/content/dam/centene/Centene%20Corporate/json/DOCUMENT/2026-08-31_centene-management-company-llc_fidelis-es_in-network.json), last updated 2026-08-31, and loads all of it:

| Billing items | Prices | Provider groups | TINs | NPIs |
|---|---|---|---|---|
| 2,530 | 359,853 | 1,908 | 4,306 | 47,129 |

### Understanding the structure

Each file is very large, so the first step was listing its key paths with `make explain-file`:

```txt
$ make explain-file FILE=path/to/2026-08-31_centene-management-company-llc_fidelis-es_in-network.json
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

A 176 MB, 3.3M-line JSON file becomes roughly 1-2 GB of Python objects, and loading it into memory would have to be repeated every session. A persisted, indexed store is the better fit.

### Ingest

`make migrate-file-to-d1` streams the file through `jq`, so it is never held in memory, and loads it into D1 in batches. Inserts use `INSERT OR IGNORE`, so a load can be rerun or resumed (`START_ITEM=`). `LIMIT_ITEMS=` and `LIMIT_PROVIDERS=` load a subset. A full load took about four minutes:

```txt
Providers (provider_references[])
  groups: 1908
Billing items (in_network[])
  items: 2530
  last item_id processed: 2529
Done in 243s, 73 batches.
```

| Table | One row per |
|---|---|
| `billing_items` | Billing item |
| `negotiated_prices` | Price on a billing item |
| `rate_provider_groups` | Link from a rate entry to a provider group |
| `provider_tins` | TIN in a provider group |
| `provider_npis` | NPI under a TIN |
| `source_files` | Loaded file: name, URL and last updated date |
| `code_summary` | Precomputed statistics per billing code (`make build-summaries`, after each ingest) |

## API

| Endpoint | Description |
|---|---|
| `GET /api/health` | Liveness check. |
| `GET /api/search?code=&npi=&ein=&setting=&class=&sort=&limit=&cursor=` | Main search. `code` is required (exact match); the other filters are optional. `sort` is `rate_desc` (default) or `rate_asc`. One row per price and TIN, with the first 25 NPIs and an `npi_count`. |
| `GET /api/rates?limit=&cursor=` | Every rate, in file order. |
| `GET /api/charges?code=&limit=&cursor=` | Every dollar rate per business for one code, for charts. Returns 2,000 rows a page unless `limit` is given. |
| `GET /api/business?name=&limit=&cursor=` | One business's rate against the median business, per exact variant (code, service, place, modifier and class). Up to 50 codes a page. |
| `GET /api/summary?code=` | Per-code statistics from `code_summary`: percentiles, range, counts, histogram and breakdowns. All variants of the code are pooled. Returns 404 until summaries are built. |
| `GET /api/suggest?q=` | Prefix suggestions: billing codes, organization names, and an exact 10-digit NPI. |
| `GET /api/codes/:code` | Billing-code metadata. |
| `GET /api/providers?npi=&ein=&groups=&limit=&cursor=` | NPIs and the TINs they belong to. Needs `npi` or `ein`; `groups` narrows to provider group ids. |
| `GET /api/org/:ein?limit=&cursor=` | Codes a TIN is priced on, against the market median per code. |
| `GET /api/provider/:npi?limit=&cursor=` | TINs for an NPI, and its rates per code. |
| `POST /api/price-ai/analyze` | Prices a plan's procedures (body: see `samples/price-ai/`, 16 KB max, 1-5 procedures). Each result has the 10 cheapest businesses with what the member and plan pay, plus `rates` (median, low, high) across every business in the ranked variant. A procedure without a usable code gets `suggestions` to pick from. No LLM. An invalid plan returns `INVALID_PLAN` with one `details` entry per problem. |
| `POST /api/price-ai/recommend` | Recommends providers for an employer. Body: `{ "message" }`, a message containing the plan as JSON (see `samples/price-ai/employer-prompt.txt`, 1-8 procedures). Procedures with too few businesses are excluded, then the fewest providers within the tie tolerance of the lowest annual spend are chosen. Returns the shortlist, spend and savings against the median, the employer/employee split and each procedure's outcome. No LLM. |
| `POST /api/price-ai/explain` | Same body. Recomputes the recommendation and has the LLM summarize it. A summary containing a number that is not in the results is replaced by a fixed template, as it is when the AI is offline (`source` says which). |
| `GET /api/price-ai/codes?q=` | Finds codes by name, e.g. `MRI knee`. Returns up to 10 priced codes, best match first. Revenue codes are left out because each covers many services. |
| `GET /api/price-ai/status` | Calls Ollama through the tunnel and reports `up`, `model_missing`, `bad_response`, `timeout`, `unreachable` or `not_configured`. Always 200; runs no model. |

- **Pagination:** pages default to 100 rows (50 for `org`, `provider` and `business`) and `limit` goes up to 500 (50 for `business`). Follow `next_cursor` until it is null. A cursor works only with the query that produced it; otherwise the API returns `INVALID_CURSOR`.
- **Validation:** codes are 1-20 letters or digits, so `0001U` and `J1745` work. NPIs are 10 digits. EINs are 9 digits, with or without a dash. `tin` is accepted as an alias for the `ein` query parameter.
- **Errors:** every error has the shape `{ "error": { "code", "message" } }`, with codes in `api/src/errors.ts`. `INVALID_PLAN` adds `details`. Database failures return `DB_ERROR` (500). The UI shows a readable message for each code.

## Price AI

1. The JSON plan is read from the message and validated.
2. Each procedure is priced within a single exact variant, so unlike services are never compared. Procedures with too few businesses are excluded.
3. The fewest providers within the tie tolerance of the lowest annual spend are chosen by exact search.
4. A model summarizes the computed results. A summary with a number not in those results is replaced by a fixed template.

Models sit behind one `Provider` interface (`api/src/priceAi/llm.ts`): Ollama on a private machine through a Cloudflare VPC Service and Tunnel, then Workers AI if it does not answer. The tables work with no model at all.

Savings assume today's spend is at the median rate and that each provider can take every visit. The rate file has no quality, location or capacity data.

## Decisions and tradeoffs

- **D1 over in-memory data:** a persisted, indexed store avoids parsing the file again.
- **Normalized tables:** they mirror the file and make ingest simple and repeatable, at the cost of joins at read time.
- **Keyset pagination, no `OFFSET` or `COUNT(*)`:** pages are ordered by a unique key, and one extra row shows whether there is a next page.
- **Keys first, details second:** search picks a page from keys alone, then looks up names and NPIs for only those rows.
- **One row per price and TIN:** TINs reached through several provider references are deduplicated, and NPIs are listed on demand.
- **Medians over business rates:** charts count each business once, at the median of its own rates.
- **No HTTP caching:** responses are `no-store`, because nothing can clear browser caches after an ingest. The UI keeps its own in-memory cache for 10 minutes.

## What's next

- Automate index discovery, downloads and multi-file ingest.
- Add a flat rates table if join costs grow, and full-text search over descriptions and names.
- Read plans from plain language, with the user confirming each value.
- Support frontier models by API key behind the same `Provider` interface.
- Add quality, location and specialty data to the recommendations.

## Timeline

2026-11-22: scaffold for the API and UI.

![Project setup](./assets/2026-11-22.png)
