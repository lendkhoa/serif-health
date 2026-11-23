-- Normalised schema for a CMS Transparency in Coverage "in-network" file.
-- Ingest uses INSERT OR IGNORE on these keys, so re-running a migration is idempotent.

-- provider_references[] -> one row per (provider_group_id, TIN)
CREATE TABLE IF NOT EXISTS provider_tins (
  provider_group_id INTEGER NOT NULL,
  tin_type          TEXT,
  tin_value         TEXT    NOT NULL,
  business_name     TEXT,
  PRIMARY KEY (provider_group_id, tin_value)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_provider_tins_tin ON provider_tins (tin_value);

-- provider_references[].provider_groups[].npi[] -> one row per NPI under a TIN
CREATE TABLE IF NOT EXISTS provider_npis (
  provider_group_id INTEGER NOT NULL,
  tin_value         TEXT    NOT NULL,
  npi               INTEGER NOT NULL,
  PRIMARY KEY (provider_group_id, tin_value, npi)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_provider_npis_npi ON provider_npis (npi);

-- in_network[] ; item_id is the item's index in the source array
CREATE TABLE IF NOT EXISTS billing_items (
  item_id                  INTEGER PRIMARY KEY,
  billing_code             TEXT NOT NULL,
  billing_code_type        TEXT,
  billing_code_type_version TEXT,
  name                     TEXT,
  description              TEXT,
  negotiation_arrangement  TEXT
);
CREATE INDEX IF NOT EXISTS idx_billing_items_code ON billing_items (billing_code);

-- in_network[].negotiated_rates[].negotiated_prices[]
-- rate_idx = index of the negotiated_rates entry, price_idx = index within its negotiated_prices
CREATE TABLE IF NOT EXISTS negotiated_prices (
  item_id                INTEGER NOT NULL,
  rate_idx               INTEGER NOT NULL,
  price_idx              INTEGER NOT NULL,
  negotiated_rate        REAL,
  negotiated_type        TEXT,
  billing_class          TEXT,
  setting                TEXT,
  expiration_date        TEXT,
  additional_information TEXT,
  billing_code_modifier  TEXT, -- JSON array
  service_code           TEXT, -- JSON array
  PRIMARY KEY (item_id, rate_idx, price_idx)
) WITHOUT ROWID;

-- in_network[].negotiated_rates[].provider_references[] -> links a rate entry to provider groups
CREATE TABLE IF NOT EXISTS rate_provider_groups (
  item_id           INTEGER NOT NULL,
  rate_idx          INTEGER NOT NULL,
  provider_group_id INTEGER NOT NULL,
  PRIMARY KEY (item_id, rate_idx, provider_group_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_rate_provider_groups_group ON rate_provider_groups (provider_group_id);
