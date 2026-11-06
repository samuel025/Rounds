.PHONY: test
test:
	npx vitest run

.PHONY: build-contract test-contract
build-contract:
	cd contract && cargo near build non-reproducible-wasm
	cd contract/mock-ft && cargo near build non-reproducible-wasm
test-contract: build-contract
	cd contract/it && cargo test -- --test-threads=2
