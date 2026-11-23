.PHONY: help install dev deploy check-node

# Wrangler and Vite need Node >= 22.12 (see .nvmrc).
check-node:
	@node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<12)) { console.error("Node >= 22.12 required (found "+process.versions.node+"). Run: nvm install && nvm use"); process.exit(1) }'

help:
	@echo "Targets:"
	@echo "  install  Install API and UI dependencies (use Node 22: nvm use)"
	@echo "  dev      Run the Workers API (:8787) and the React UI with hot reload"
	@echo "  deploy   Build the UI and deploy the Worker (serves API + UI)"
	@echo "  help     Show this help message"

install: check-node
	npm install

dev: check-node
	npm run dev

deploy: check-node
	npm run build
	npm run deploy
