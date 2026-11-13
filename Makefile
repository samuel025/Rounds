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
	cd contract/open-board && cargo near build non-reproducible-wasm
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

# drives the app's wallet buttons on testnet with a DEV-only test signer (needs `make web-dev` running)
e2e-wallet:
	node scripts/e2e-wallet.mjs

# deploys a fresh OPEN sandbox on testnet for judges (needs the near CLI; see scripts/sandbox.ts)
sandbox:
	npx vite-node scripts/sandbox.ts


# demo step 10 (after `make demo`): the DAO treasury shares a $100,000 pot with every shareholder, pro rata; once per demo deployment
.PHONY: distribute
distribute:
	npx vite-node scripts/distribute.ts

# demo step 11 (after `make demo`): SAFTs and a project token on a second Rounds contract; needs ~8 testnet NEAR from old demo accounts
# (TOKENS_FUND_FROM=<old suffixes>) and runs once per demo deployment; `make verify-tokens` re-checks it read-only
.PHONY: tokens verify-tokens
tokens:
	npx vite-node scripts/tokens.ts
verify-tokens:
	@npx vite-node scripts/verify-tokens.ts > results/verify-tokens.txt; code=$$?; cat results/verify-tokens.txt; exit $$code

# drives the "Share a pot on testnet" card with the DEV-only test signer on an open sandbox (needs `make web-dev` running); writes a few testnet transactions
.PHONY: e2e-share
e2e-share:
	node scripts/e2e-share.mjs

# ---- confidential mode (ZK), branch feat/zk-confidential ----
# compiles the circom circuits and runs a LOCAL, single-contributor Powers of Tau + Groth16 setup (dev/demo only; see README)
.PHONY: circuits zk-fixtures e2e-zk
circuits:
	bash scripts/build-circuits.sh
# regenerates the proofs the contract's sandbox test replays (needs `make circuits` first)
zk-fixtures:
	npx vite-node scripts/zk-fixtures.ts
# drives the Confidential mode card with the DEV-only test signer on the confidential sandbox (needs `make web-dev` running); writes testnet transactions
e2e-zk:
	node scripts/e2e-zk.mjs

# the wallet-derived keys, sealed data and relayer fee on the confidential sandbox (needs `make web-dev` running, the near CLI, Chrome, the judge and relayer keys)
.PHONY: e2e-keys
e2e-keys:
	node scripts/e2e-keys.mjs | tee results/e2e-keys.txt

# a local claim relayer so a holder's wallet never signs the claim (needs a funded testnet account: RELAYER_ACCOUNT=...)
.PHONY: relayer
relayer:
	RELAYER_CONTRACT=$${RELAYER_CONTRACT:-$$(node -p 'require("./web/public/zk-sandbox.json").rounds')} RELAYER_CREDENTIALS=$${RELAYER_CREDENTIALS:-$$HOME/.near-credentials/testnet/$$RELAYER_ACCOUNT.json} RELAYER_ACCOUNT=$$RELAYER_ACCOUNT node scripts/relayer.mjs
