.PHONY: test conformance
test:
	npx vitest run
	$(MAKE) conformance

conformance:
	python3 -I ref/conformance.py 1000

.PHONY: build-contract test-contract
build-contract:
	cd contract && cargo near build non-reproducible-wasm
	cd contract/mock-ft && cargo near build non-reproducible-wasm
test-contract: build-contract
	cd contract/it && cargo test -- --test-threads=2

.PHONY: web web-dev
web:
	node scripts/rules-html.mjs && npx vite build
web-dev:
	node scripts/rules-html.mjs && npx vite

.PHONY: demo
demo: build-contract
	npx vite-node scripts/demo.ts

.PHONY: verify-onchain replay
verify-onchain:
	@npx vite-node scripts/verify-onchain.ts > results/verify-onchain.txt; code=$$?; cat results/verify-onchain.txt; exit $$code
replay:
	@npx vite-node scripts/replay.ts > results/replay.txt; code=$$?; cat results/replay.txt; exit $$code

.PHONY: summary check-readme
summary:
	node scripts/summary.mjs
check-readme:
	node scripts/check-readme.mjs

# static deploy of the built app to Vercel (needs `vercel login`); publishes only dist/ plus deploy/vercel.json, never the repo
deploy: web
	rm -rf .deploy && mkdir -p .deploy/rounds-cap-table && cp -r dist/. .deploy/rounds-cap-table/ && cp deploy/vercel.json .deploy/rounds-cap-table/ && cd .deploy/rounds-cap-table && vercel deploy --prod --yes
