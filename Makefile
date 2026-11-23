.PHONY: help install dev deploy check-node explain-file migrate-file-to-d1 d1-migrate nuke-dev-db

# Wrangler and Vite need Node >= 22.12 (see .nvmrc).
check-node:
	@node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<12)) { console.error("Node >= 22.12 required (found "+process.versions.node+"). Run: nvm install && nvm use"); process.exit(1) }'

help:
	@echo "Targets:"
	@echo "  install  Install API and UI dependencies (use Node 22: nvm use)"
	@echo "  dev      Run the Workers API (:8787) and the React UI with hot reload"
	@echo "  deploy   Build the UI and deploy the Worker (serves API + UI)"
	@echo "  explain-file  Print unique key paths of a large JSON file (FILE=path/to.json)"
	@echo "  d1-migrate  Apply api/migrations to D1 (add LOCAL=1 for local)"
	@echo "  migrate-file-to-d1  Load a big JSON file into D1 (FILE=path [LIMIT_ITEMS=n] [LIMIT_PROVIDERS=n] [START_ITEM=n] [LOCAL=1])"
	@echo "  build-summaries  Rebuild the precomputed code_summary table; run after each ingest (LOCAL=1 for local)"
	@echo "  nuke-dev-db  Delete ALL rows from the D1 tables, keeping the schema (LOCAL=1 for local; CONFIRM=yes skips the prompt)"
	@echo "  help     Show this help message"

install: check-node
	npm install

dev: check-node
	npm run dev

deploy: check-node
	npm run build
	npm run deploy

# Usage: make explain-file FILE=~/Downloads/big.json
explain-file:
	@test -n "$(FILE)" || { echo "Usage: make explain-file FILE=path/to.json"; exit 1; }
	@python3 -I scripts/schema_skeleton.py "$(FILE)"

d1-migrate: check-node
	cd api && npx wrangler d1 migrations apply DB $(if $(LOCAL),--local,--remote)

# Usage: make migrate-file-to-d1 FILE=path.json LIMIT_ITEMS=1000 LIMIT_PROVIDERS=5000 [LOCAL=1]
migrate-file-to-d1: check-node
	@test -n "$(FILE)" || { echo "Usage: make migrate-file-to-d1 FILE=path.json [LIMIT_ITEMS=n] [LIMIT_PROVIDERS=n] [START_ITEM=n] [LOCAL=1]"; exit 1; }
	@python3 -I scripts/migrate_file.py "$(FILE)" \
		$(if $(LIMIT_ITEMS),--limit-items $(LIMIT_ITEMS)) \
		$(if $(LIMIT_PROVIDERS),--limit-providers $(LIMIT_PROVIDERS)) \
		$(if $(START_ITEM),--start-item $(START_ITEM)) \
		$(if $(LOCAL),--local) \
		$(if $(SOURCE_URL),--source-url '$(SOURCE_URL)') \
		$(if $(LAST_UPDATED_ON),--last-updated-on '$(LAST_UPDATED_ON)')

# Recomputes per-code statistics served by /api/summary. Run after migrate-file-to-d1.
build-summaries: check-node
	cd api && npx wrangler d1 execute DB $(if $(LOCAL),--local,--remote) --file ../scripts/build_code_summary.sql --yes

# Deletes every row (schema and migration history stay) so migrate-file-to-d1 can start fresh.
NUKE_TABLES = code_summary source_files rate_provider_groups negotiated_prices billing_items provider_npis provider_tins
nuke-dev-db: check-node
	@echo "This will DELETE ALL ROWS from: $(NUKE_TABLES)"
	@echo "Target: $(if $(LOCAL),LOCAL D1,REMOTE D1 (09fc014c-adc2-48c1-8ae9-62ea3bd9f2c5))"
	@if [ "$(CONFIRM)" != "yes" ]; then read -p "Type 'nuke' to continue: " a; [ "$$a" = "nuke" ] || { echo "Aborted."; exit 1; }; fi
	cd api && npx wrangler d1 execute DB $(if $(LOCAL),--local,--remote --yes) --command "$(foreach t,$(NUKE_TABLES),DELETE FROM $(t);)"
