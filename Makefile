.PHONY: test
test:
	npx vitest run

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
