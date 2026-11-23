-- Provenance: every billing item records the file it came from.
CREATE TABLE IF NOT EXISTS source_files (
  source_file_id  INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  url             TEXT,
  last_updated_on TEXT,
  loaded_at       TEXT DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE billing_items ADD COLUMN source_file_id INTEGER NOT NULL DEFAULT 1;

-- Precomputed per-code statistics, rebuilt after ingest by scripts/build_code_summary.sql.
CREATE TABLE IF NOT EXISTS code_summary (
  billing_code       TEXT PRIMARY KEY,
  price_count        INTEGER NOT NULL,
  org_count          INTEGER NOT NULL,
  provider_count     INTEGER NOT NULL,
  min_rate           REAL,
  p25                REAL,
  median             REAL,
  p75                REAL,
  max_rate           REAL,
  by_setting         TEXT, -- JSON [{value,count,min,max}]
  by_billing_class   TEXT,
  by_negotiated_type TEXT,
  histogram          TEXT  -- JSON [{bucket,count}], 10 equal-width buckets between min and max
) WITHOUT ROWID;

-- Case-insensitive prefix index backing organisation suggestions in /api/suggest (range scan).
CREATE INDEX IF NOT EXISTS idx_provider_tins_name_nc ON provider_tins (business_name COLLATE NOCASE);
