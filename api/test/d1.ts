import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

/** Minimal in-memory D1 stand-in over node:sqlite (just prepare/bind/all). */
export function createTestDb({ only0001 = false } = {}): D1Database {
  const sqlite = new DatabaseSync(':memory:')
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
  sqlite.exec(read('../migrations/0001_init.sql'))
  sqlite.exec(read('../migrations/0002_summary_source_suggest.sql'))
  sqlite.exec(`
    INSERT INTO billing_items (item_id,billing_code,billing_code_type,billing_code_type_version,name,description,negotiation_arrangement) VALUES
      (1,'99213','CPT','2026','Office visit','Office or other outpatient visit','negotiated'),
      (2,'J1745','HCPCS','2026','Infliximab','Injection, infliximab','negotiated'),
      (3,'0001U','CPT','2026','Lab panel','Proprietary lab panel','negotiated');
    INSERT INTO source_files (source_file_id,name,url,last_updated_on) VALUES (1,'file.json','http://src/file.json','2026-08-31');
    INSERT INTO negotiated_prices (item_id,rate_idx,price_idx,negotiated_rate,negotiated_type,billing_class,setting,service_code,billing_code_modifier) VALUES
      (1,0,0,100,'negotiated','professional','office','["11"]','["25"]'),
      (1,1,0,150,'negotiated','professional','office',NULL,NULL),
      (1,2,0,200,'negotiated','institutional','outpatient',NULL,NULL),
      (1,3,0,NULL,'negotiated','professional','office',NULL,NULL),
      (2,0,0,50,'negotiated','professional','office',NULL,NULL);
    INSERT INTO provider_tins VALUES (10,'ein','111111111','Alpha Clinic'), (11,'ein','222222222','Beta Hospital'),
      (12,'ein','111111111','Alpha Clinic');
    INSERT INTO provider_npis VALUES (10,'111111111',1000000001), (10,'111111111',1000000002),
      (11,'222222222',1000000003), (12,'111111111',1000000001);
    INSERT INTO rate_provider_groups VALUES (1,0,10),(1,0,12),(1,1,11),(1,2,10),(2,0,11);
    -- EIN published with a dash, as in the real Fidelis file
    INSERT INTO billing_items (item_id,billing_code,name) VALUES (4,'DASH1','Dashed');
    INSERT INTO negotiated_prices (item_id,rate_idx,price_idx,negotiated_rate) VALUES (4,0,0,10);
    INSERT INTO provider_tins VALUES (14,'ein','44-4444444','Delta Dash');
    INSERT INTO provider_npis VALUES (14,'44-4444444',1000000010);
    INSERT INTO rate_provider_groups VALUES (4,0,14);
    -- one price shared by two TINs
    INSERT INTO billing_items (item_id,billing_code,name) VALUES (5,'MULTI','Two TINs');
    INSERT INTO negotiated_prices (item_id,rate_idx,price_idx,negotiated_rate) VALUES (5,0,0,7);
    INSERT INTO provider_tins VALUES (15,'ein','555555555','Eps'), (15,'ein','666666666','Zeta');
    INSERT INTO rate_provider_groups VALUES (5,0,15);
    -- provider only attached to a rate with a null price: must not count in summaries
    INSERT INTO provider_tins VALUES (13,'ein','333333333','Gamma Null');
    INSERT INTO provider_npis VALUES (13,'333333333',1000000009);
    INSERT INTO rate_provider_groups VALUES (1,3,13);
  `)
  sqlite.exec(read('../../scripts/build_code_summary.sql'))
  if (only0001) {
    sqlite.exec(`DROP TABLE source_files; DROP TABLE code_summary; DROP INDEX idx_provider_tins_name_nc;
      ALTER TABLE billing_items DROP COLUMN source_file_id;`)
  }
  return {
    prepare(sql: string) {
      let args: unknown[] = []
      const stmt = {
        bind(...a: unknown[]) {
          args = a
          return stmt
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...(args as any[])) }
        },
      }
      return stmt
    },
  } as unknown as D1Database
}
