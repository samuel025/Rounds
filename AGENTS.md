# AGENTS.md — for AI reviewers

Rounds is a testnet cap-table demo. Start with README.md; every claim there has a command below. Nothing here needs a key or real money.

## Verified commands (run from the repo root; expected output)

| Command | Needs | Expected |
|---|---|---|
| `npm install` | network | installs TypeScript, Vitest, fast-check, Vite |
| `make test` | node, python3 | Vitest: all test files pass (see `tests.engine` in `results/summary.json`); then `python3 -I ref/conformance.py 1000` prints `"mismatches": 0` |
| `make replay` | node only, **no network** | step list with testnet transaction links, rebuilt cap table, exit payouts; last line `PASS summary: <n> checks, 0 failed` |
| `make verify-onchain` | network (read-only RPC) | every line starts with `PASS`; last line `PASS summary: <n> checks, 0 failed`. A line starting `FAIL` means a mismatch with the chain or an unreachable RPC |
| `make sandbox` | near CLI, network, faucet or `SANDBOX_FUND_FROM` | deploys a fresh open sandbox (testnet); `results/sandbox.json` lists it; `SANDBOX_TOKEN` reuses a token contract |
| `make e2e-wallet` | `make web-dev` running, near CLI, Chrome, demo keys in `~/.near-credentials` | drives the app's wallet buttons on testnet via a DEV-only test signer; `PASS summary: 11 checks, 0 failed`. Writes a few testnet transactions on a superseded deployment |
| `make check-readme` | node | `PASS summary: <n> tagged numbers checked, 0 failed` |
| `make summary` | node, python-generated conformance files, cargo (to list sandbox tests) | rewrites `results/summary.json` |
| `make web` / `make web-dev` | node | static site in `dist/` / dev server |
| `make test-contract` | rust (wasm32 target), cargo-near, network for the sandbox binary | 10 sandbox tests pass |
| `make demo` | `near` CLI (near-cli-rs), network, public faucet | scripted testnet run; **creates fresh throwaway accounts; do not run casually** |

`make verify-onchain` and `make replay` read `results/demo-*.json` (committed) and the testnet contract named in `results/demo-addresses.json`.

## Repo map

- `RULES.md` — the equity math, written first; the code follows it. `docs/NOTES.md` (findings), `docs/DECISIONS.md` (every departure from the PRD).
- `src/engine/` — pure TypeScript engine: `index.ts` (SAFE conversion, priced round), `waterfall.ts`, `vesting.ts`, `plan.ts` (RFC 8785 canonical JSON, sha256 plan hash), `rat.ts` (exact rationals).
- `test/` — golden vectors (GV-1..GV-4), properties P1–P9 (fast-check), plan hashing. `vectors/` — GV-1 and GV-2 data.
- `ref/` — Python reference (`rounds_ref.py`) and conformance harness; `scripts/conformance-ts.ts` runs the TS side.
- `contract/` — Rust Rounds contract; `contract/mock-ft` test token; `contract/open-board` the open board used only by the judge sandbox (no unit tests; exercised by `make e2e-wallet`); `contract/it` sandbox tests; `spike/stub` the Sputnik spike contract.
- `scripts/` — `demo.ts` (testnet run), `plans.ts` (rebuilds every plan from the engine), `verify-onchain.ts`, `replay.ts`, `summary.mjs`, `check-readme.mjs`, `rules-html.mjs`.
- `web/` — static app (Vite, vanilla TypeScript); reads `web/public/deployment.json` and `events.json`.
- `results/` — committed outputs of real runs (demo log, transactions, events, plans, conformance and verify output, `summary.json`).

## Out of scope

Legal documents, KYC, banking, secondary markets, tax, real securities, mainnet. The wallet is testnet-only; no mainnet. No confidential mode. No NEAR AI Cloud assistant. SAFE terms not modelled: MFN, pro-rata side letters.

## Known slow or flaky steps

- `make test-contract`: first run downloads the near-workspaces sandbox binary and compiles a large dependency tree (several minutes); later runs take about a minute.
- `make verify-onchain` and `make demo`: testnet RPC can time out; the scripts retry. The testnet faucet rate-limits after about 7 accounts per run; `make demo` then funds the remaining accounts from earlier demo accounts, or from a previous run's accounts with `DEMO_FUND_FROM=<old suffix>`.
- `make demo` has no cleanup and creates new accounts each time unless `DEMO_SUFFIX` is set to resume.

## Things to check skeptically

- The Python reference and the TypeScript engine were written by the same author in one session.
- The committed demo run's vesting read is pinned to a block inside month 12 and equals the engine's 25,000. The failed attacks' transaction hashes are in `results/demo-attacks.json` and are re-checked by `make verify-onchain`.
- The SAFE clause citations in `RULES.md` map each rule to the YC post-money forms in `ref/`. Cap-plus-discount SAFEs are Rounds' own extension (not in the YC forms); Promised Options, pre-round exits and MFN are not modelled.
