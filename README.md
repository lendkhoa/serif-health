# Serif Health
## Price Transparency Explorer

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

