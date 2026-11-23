#!/usr/bin/env python3
"""Stream a large CMS in-network JSON file into the D1 database, in batches.

The file is never loaded into memory: `jq --stream` yields one provider_reference or
in_network item at a time, which is turned into multi-row INSERT OR IGNORE statements
(idempotent, so re-running or resuming is safe) and pushed with `wrangler d1 execute`.

Usage:
  migrate_file.py PATH [--limit-items N] [--limit-providers N] [--start-item N]
                  [--batch-kb 512] [--source-url URL] [--last-updated-on DATE] [--local | --dry-run] [--skip-providers] [--skip-items]
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

API_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api")
MAX_STMT_BYTES = 60_000  # D1 limit is 100KB per statement
MAX_STMT_ROWS = 100
SOURCE_FILE_ID = 1

# Emits each element of the top-level array `key` as a compact JSON line, streaming.
JQ_ARRAY = "fromstream(2 | truncate_stream(inputs | select(.[0][0] == $key)))"


def stream_array(path, key):
    proc = subprocess.Popen(
        ["jq", "-cn", "--stream", "--arg", "key", key, JQ_ARRAY, path],
        stdout=subprocess.PIPE, text=True, bufsize=1 << 20,
    )
    try:
        for line in proc.stdout:
            yield json.loads(line)
    finally:
        proc.stdout.close()
        proc.terminate()
        proc.wait()


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, (list, dict)):
        v = json.dumps(v, separators=(",", ":"))
    return "'" + str(v).replace("'", "''") + "'"


class Batcher:
    """Buffers rows per table, emits multi-row INSERT OR IGNORE, flushes to D1 past a size cap."""

    def __init__(self, args):
        self.args = args
        self.rows = {}  # table -> (columns, [row sql])
        self.stmts = []
        self.bytes = 0
        self.flushes = 0

    def add(self, table, cols, values):
        _, buf = self.rows.setdefault(table, (cols, []))
        buf.append("(" + ",".join(lit(v) for v in values) + ")")
        if len(buf) >= MAX_STMT_ROWS or sum(map(len, buf)) >= MAX_STMT_BYTES:
            self._seal(table)

    def _seal(self, table):
        cols, buf = self.rows[table]
        if buf:
            sql = f"INSERT OR IGNORE INTO {table} ({','.join(cols)}) VALUES {','.join(buf)};"
            self.stmts.append(sql)
            self.bytes += len(sql)
            self.rows[table] = (cols, [])

    def maybe_flush(self):
        if self.bytes >= self.args.batch_kb * 1024:
            self.flush()

    def flush(self):
        for t in list(self.rows):
            self._seal(t)
        if not self.stmts:
            return
        sql = "\n".join(self.stmts)
        self.stmts, self.bytes = [], 0
        self.flushes += 1
        if self.args.dry_run:
            return
        with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False) as f:
            f.write(sql)
            name = f.name
        try:
            execute_file(name, self.args)
        finally:
            os.unlink(name)


def execute_file(sql_path, args):
    cmd = ["npx", "wrangler", "d1", "execute", "DB",
           "--local" if args.local else "--remote", "--file", sql_path, "--yes"]
    for attempt in range(1, 4):
        r = subprocess.run(cmd, cwd=API_DIR, capture_output=True, text=True)
        if r.returncode == 0:
            return
        print(f"\n  wrangler failed (attempt {attempt}/3): {(r.stderr or r.stdout).strip()[-400:]}",
              file=sys.stderr)
        time.sleep(2 * attempt)
    sys.exit("Giving up after 3 failed attempts; resume with --start-item / --skip-providers.")


def progress(label, n, limit, t0):
    rate = n / max(time.time() - t0, 1e-6)
    tot = f"/{limit}" if limit else ""
    print(f"\r  {label}: {n}{tot} ({rate:,.0f}/s)", end="", flush=True)


def ingest_providers(path, b, args):
    print("Providers (provider_references[])")
    t0, n = time.time(), 0
    for ref in stream_array(path, "provider_references"):
        if args.limit_providers and n >= args.limit_providers:
            break
        gid = ref["provider_group_id"]
        for g in ref.get("provider_groups", []):
            tin = g.get("tin", {})
            tv = tin.get("value")
            b.add("provider_tins", ["provider_group_id", "tin_type", "tin_value", "business_name"],
                  [gid, tin.get("type"), tv, tin.get("business_name")])
            for npi in g.get("npi", []):
                b.add("provider_npis", ["provider_group_id", "tin_value", "npi"], [gid, tv, npi])
        n += 1
        b.maybe_flush()
        if n % 500 == 0:
            progress("groups", n, args.limit_providers, t0)
    b.flush()
    progress("groups", n, args.limit_providers, t0)
    print()


def ingest_items(path, b, args):
    print("Billing items (in_network[])")
    t0, n = time.time(), 0
    for idx, item in enumerate(stream_array(path, "in_network")):
        if idx < args.start_item:
            continue
        if args.limit_items and n >= args.limit_items:
            break
        b.add("billing_items",
              ["item_id", "billing_code", "billing_code_type", "billing_code_type_version",
               "name", "description", "negotiation_arrangement", "source_file_id"],
              [idx, item.get("billing_code"), item.get("billing_code_type"),
               item.get("billing_code_type_version"), item.get("name"), item.get("description"),
               item.get("negotiation_arrangement"), SOURCE_FILE_ID])
        for r_idx, rate in enumerate(item.get("negotiated_rates", [])):
            for gid in rate.get("provider_references", []):
                b.add("rate_provider_groups", ["item_id", "rate_idx", "provider_group_id"],
                      [idx, r_idx, gid])
            for p_idx, p in enumerate(rate.get("negotiated_prices", [])):
                b.add("negotiated_prices",
                      ["item_id", "rate_idx", "price_idx", "negotiated_rate", "negotiated_type",
                       "billing_class", "setting", "expiration_date", "additional_information",
                       "billing_code_modifier", "service_code"],
                      [idx, r_idx, p_idx, p.get("negotiated_rate"), p.get("negotiated_type"),
                       p.get("billing_class"), p.get("setting"), p.get("expiration_date"),
                       p.get("additional_information"), p.get("billing_code_modifier"),
                       p.get("service_code")])
        n += 1
        b.maybe_flush()
        if n % 100 == 0:
            progress("items", n, args.limit_items, t0)
    b.flush()
    progress("items", n, args.limit_items, t0)
    print(f"\n  last item_id processed: {args.start_item + n - 1 if n else 'n/a'}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path")
    ap.add_argument("--limit-items", type=int, default=0, help="max in_network items (0 = all)")
    ap.add_argument("--limit-providers", type=int, default=0, help="max provider_references (0 = all)")
    ap.add_argument("--start-item", type=int, default=0, help="skip in_network items before this index (resume)")
    ap.add_argument("--batch-kb", type=int, default=512, help="SQL size per wrangler call (default 512)")
    ap.add_argument("--local", action="store_true", help="use the local D1 instead of remote")
    ap.add_argument("--dry-run", action="store_true", help="parse and batch but do not execute")
    ap.add_argument("--source-url", help="URL the file was downloaded from (stored as provenance)")
    ap.add_argument("--last-updated-on", help="the file's last_updated_on value (stored as provenance)")
    ap.add_argument("--skip-providers", action="store_true")
    ap.add_argument("--skip-items", action="store_true")
    args = ap.parse_args()

    b = Batcher(args)
    t0 = time.time()
    # One source file per database for now: every billing item references source_file_id = 1.
    b.add("source_files", ["source_file_id", "name", "url", "last_updated_on"],
          [SOURCE_FILE_ID, os.path.basename(args.path), args.source_url, args.last_updated_on])
    if not args.skip_providers:
        ingest_providers(args.path, b, args)
    if not args.skip_items:
        ingest_items(args.path, b, args)
    print(f"Done in {time.time() - t0:.0f}s, {b.flushes} batches"
          f"{' (dry run)' if args.dry_run else ''}.")


if __name__ == "__main__":
    main()
