-- Rebuilds code_summary from the ingested tables. Run after each ingest:
--   make build-summaries [LOCAL=1]
-- Only prices with a non-null negotiated_rate count, and org/provider counts only include
-- providers attached to a rate entry that has at least one such price.
DELETE FROM code_summary;

INSERT INTO code_summary
WITH rated AS (
  SELECT b.billing_code AS code, p.negotiated_rate AS rate,
         p.setting, p.billing_class, p.negotiated_type
    FROM negotiated_prices p JOIN billing_items b ON b.item_id = p.item_id
   WHERE p.negotiated_rate IS NOT NULL
),
ranked AS (
  SELECT code, rate,
         ROW_NUMBER() OVER (PARTITION BY code ORDER BY rate) AS rn,
         COUNT(*) OVER (PARTITION BY code) AS cnt
    FROM rated
),
stats AS ( -- nearest-rank percentiles: row floor((n-1)*q)+1
  SELECT code, MAX(cnt) AS n, MIN(rate) AS mn, MAX(rate) AS mx,
         MAX(CASE WHEN rn = CAST((cnt - 1) * 0.25 AS INTEGER) + 1 THEN rate END) AS p25,
         MAX(CASE WHEN rn = CAST((cnt - 1) * 0.50 AS INTEGER) + 1 THEN rate END) AS p50,
         MAX(CASE WHEN rn = CAST((cnt - 1) * 0.75 AS INTEGER) + 1 THEN rate END) AS p75
    FROM ranked GROUP BY code
),
valid_rates AS (
  SELECT DISTINCT p.item_id, p.rate_idx FROM negotiated_prices p WHERE p.negotiated_rate IS NOT NULL
),
orgs AS (
  SELECT b.billing_code AS code, COUNT(DISTINCT t.tin_value) AS c
    FROM valid_rates v
    JOIN billing_items b ON b.item_id = v.item_id
    JOIN rate_provider_groups r ON r.item_id = v.item_id AND r.rate_idx = v.rate_idx
    JOIN provider_tins t ON t.provider_group_id = r.provider_group_id
   GROUP BY b.billing_code
),
npis AS (
  SELECT b.billing_code AS code, COUNT(DISTINCT n.npi) AS c
    FROM valid_rates v
    JOIN billing_items b ON b.item_id = v.item_id
    JOIN rate_provider_groups r ON r.item_id = v.item_id AND r.rate_idx = v.rate_idx
    JOIN provider_npis n ON n.provider_group_id = r.provider_group_id
   GROUP BY b.billing_code
),
by_setting AS (
  SELECT code, json_group_array(json_object('value', v, 'count', c, 'min', mn, 'max', mx)) AS j
    FROM (SELECT code, setting AS v, COUNT(*) AS c, MIN(rate) AS mn, MAX(rate) AS mx
            FROM rated GROUP BY code, setting) GROUP BY code
),
by_class AS (
  SELECT code, json_group_array(json_object('value', v, 'count', c, 'min', mn, 'max', mx)) AS j
    FROM (SELECT code, billing_class AS v, COUNT(*) AS c, MIN(rate) AS mn, MAX(rate) AS mx
            FROM rated GROUP BY code, billing_class) GROUP BY code
),
by_type AS (
  SELECT code, json_group_array(json_object('value', v, 'count', c, 'min', mn, 'max', mx)) AS j
    FROM (SELECT code, negotiated_type AS v, COUNT(*) AS c, MIN(rate) AS mn, MAX(rate) AS mx
            FROM rated GROUP BY code, negotiated_type) GROUP BY code
),
hist AS (
  SELECT code, json_group_array(json_object('bucket', bucket, 'count', c)) AS j
    FROM (SELECT r.code AS code,
                 CASE WHEN s.mx = s.mn THEN 0
                      ELSE MIN(CAST((r.rate - s.mn) / ((s.mx - s.mn) / 10.0) AS INTEGER), 9) END AS bucket,
                 COUNT(*) AS c
            FROM rated r JOIN stats s ON s.code = r.code
           GROUP BY r.code, bucket ORDER BY r.code, bucket)
   GROUP BY code
)
SELECT s.code, s.n, COALESCE(o.c, 0), COALESCE(n.c, 0), s.mn, s.p25, s.p50, s.p75, s.mx,
       bs.j, bc.j, bt.j, h.j
  FROM stats s
  LEFT JOIN orgs o ON o.code = s.code
  LEFT JOIN npis n ON n.code = s.code
  LEFT JOIN by_setting bs ON bs.code = s.code
  LEFT JOIN by_class bc ON bc.code = s.code
  LEFT JOIN by_type bt ON bt.code = s.code
  LEFT JOIN hist h ON h.code = s.code;
