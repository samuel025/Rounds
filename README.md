# Rounds — a cap table on NEAR that shows its work

> **Not legal or financial advice.** Rounds is a model and a **NEAR testnet demo**, not a securities offering. It claims no legal validity for any instrument. All money is a test token with no value. Holdings on the demo contract are **public on chain**. Built at NEAR HACKATHON (Nov 2026).

Cap tables live in spreadsheets and PDFs, and nobody can check them. Rounds is a cap-table tool where a pure, exact equity engine does the math (common and preferred shares, option pool, post-money SAFEs, priced rounds with pool top-up, vesting, exit waterfall), a Sputnik DAO board approves each round and exit **by plan hash**, and anyone can re-verify the result against the chain.

## Headline results

Every number below is checked against `results/summary.json` by `make check-readme`.

- The engine reproduces the golden vectors GV-1 (a Series A with two converting SAFEs) and GV-2 (an exit waterfall), plus hand-checked cases GV-3 (discount-only SAFE), GV-4 (options in and out of the money), GV-5 (cap wins, then discount wins), GV-6 (no pool top-up) and GV-7 (down round below the SAFE cap). The expected values of GV-5 to GV-7 were derived on paper first (docs/NOTES.md). Engine tests: <!--n:tests.engine-->21<!--/n--> passing, including <!--n:tests.properties-->9<!--/n--> property tests.
- A second implementation in Python agrees with the TypeScript engine on <!--n:conformance.scenarios-->1000<!--/n--> seeded random scenarios (<!--n:conformance.mismatches-->0<!--/n--> mismatches; <!--n:conformance.rejected_inputs-->40<!--/n--> deliberately invalid inputs rejected by both).
- The Rust contract passes <!--n:tests.sandbox-->6<!--/n--> near-workspaces sandbox tests (full round and exit, wrong-token refund, non-board approval, hash mismatch, double close, exact refunds, hostile token, failed-transfer retry, private callbacks, vesting and exercise).
- On **testnet**, a Series A with two converting SAFEs closed through a 2-of-3 Sputnik DAO vote and an exit paid every holder. The final demo run recorded <!--n:demo.transactions-->53<!--/n--> transactions and <!--n:demo.events-->23<!--/n--> contract events, and <!--n:demo.rounds_closed-->4<!--/n--> rounds closed.
- `make verify-onchain` (read-only) recomputes the demo from the engine and compares with the chain: <!--n:verify_onchain.checks-->19<!--/n--> checks, <!--n:verify_onchain.failed-->0<!--/n--> failed.
- `make replay` (no network) rebuilds the cap table and exit from committed events: <!--n:replay.checks-->8<!--/n--> checks, <!--n:replay.failed-->0<!--/n--> failed.

## Try it

| Do this | See this |
|---|---|
| `npm install && make test` | Engine tests and properties pass, then the Python conformance prints `"mismatches": 0` |
| `make replay` | Offline: the step list with transaction links, the rebuilt cap table, the exit payouts, and a last line `PASS summary: … 0 failed` |
| `make verify-onchain` | Read-only, needs network: every line starts with `PASS`; the last line ends with `0 failed` |
| `make test-contract` | Builds the contract and mock token, then the sandbox tests pass (about a minute; downloads the sandbox binary the first time) |
| `make web-dev` | The app on a local port: dilution chart, cap table, round modeler, investor and employee views, exit simulator, events and Verify. `make web` builds a static site into `dist/`. **There is no hosted instance yet.** |
| `make demo` | Scripted testnet run (needs `near` CLI, network and the faucet; see the note below) |
| `make check-readme` | Fails if a number in this README differs from `results/summary.json` |

The app has no wallet. "Propose on chain" shows the plan hash and the exact `near` command; "Run exit" is a simulation. The Verify button reads the live contract named in `web/public/deployment.json`.

## The engine in brief

Rules are in [RULES.md](RULES.md); the code follows it. Shares are integers, money is integer micro-dollars, ratios are exact rationals (BigInt); there is no floating point. Every rounding remainder is reported, never silently dropped.

- **Post-money SAFE, cap only:** each SAFE gets exactly its purchase amount divided by its cap, of the capitalization just before the round. With a discount, it converts at the lower of the cap price and the discounted round price, solved by exact fixed-point iteration (fails loudly after 1,000 iterations).
- **Priced round:** the pool top-up sits in the pre-money, so it dilutes existing holders and SAFEs but not the new investor. Price = (pre-money − target × post-money) / (issued + SAFE shares), rounded down to 4 decimals.
- **Exit waterfall:** non-participating preferred takes its preference or converts, whichever pays more; ranks pay in order, pro rata within a rank; options exercise only above their strike.
- **Golden vectors** (`vectors/gv-1.json` to `vectors/gv-7.json`; GV-3 and GV-4 live in `test/`): GV-1 gives a $2.00 price, 15,000,000 fully diluted shares, Fund 4,500,000, SAFE 1 at $0.50 and SAFE 2 at $1.00. GV-2 at a $20M exit: Ada $6,111,111.11, Bayo $3,361,111.11, SAFE 1 $1,222,222.22, SAFE 2 $305,555.56, Fund $9,000,000.00.

## Testnet addresses and transactions (final demo run)

Network: NEAR testnet. Throwaway accounts, no value.

| Thing | Account |
|---|---|
| Rounds contract | `rounds-core-012465.testnet` |
| Board (Sputnik DAO v2.0.0, 2-of-3 council) | `rounds-board-012465.sputnik-v2.testnet` |
| Test USDC (6 decimals, public faucet) | `rounds-usdc-012465.testnet` |

| Demo step | Key transaction |
|---|---|
| Founders and pool closed (after a board vote) | [CkHeL9iH…](https://explorer.testnet.near.org/transactions/CkHeL9iHHsyAow3GzyEReifJUUt4diVDPfx1C1DJmiAo) |
| SAFE 1 closed, SAFE 2 closed | [7AFccoWM…](https://explorer.testnet.near.org/transactions/7AFccoWMPQWjdbhQATZgeRERn4BmKwrDvnS41miwovfU), [236sxtba…](https://explorer.testnet.near.org/transactions/236sxtbaQH1aJ2Yh6XEo9PXtPuWBBRewcS7mDCgHMFPz) |
| Fund pays $9,000,000 into escrow | [6KwpDCDq…](https://explorer.testnet.near.org/transactions/6KwpDCDq68Vab8DD6MYFCiRePntVSeLtgEXsC2WXi3iG) |
| Series A closed, holdings credited | [A1DEtpzP…](https://explorer.testnet.near.org/transactions/A1DEtpzPqHsKs8bcWjgJfFxesBeVMtCp1PQ9w2zsSu2J) |
| Wrong-token deposit (refunded in full) | [4FzRSisx…](https://explorer.testnet.near.org/transactions/4FzRSisx2x9BF2esmFcBJJLSnNHateUNKtJTkrnhsMkS) |
| Board executes the option grant for Efe | [HxsLLm2K…](https://explorer.testnet.near.org/transactions/HxsLLm2KYKa47hnK5grwV38pW2VEt5RrZ4z47x9mqgxM) |
| Zed funds the $20M exit; board approves; distribute | [4pZF66uj…](https://explorer.testnet.near.org/transactions/4pZF66ujz6sKKaATAV8WHtZGTUukj5rHq9Dnzm8AHzHe), [FXrmSWTZ…](https://explorer.testnet.near.org/transactions/FXrmSWTZ2GvrcJip7Yz8LqvXmsGX364Fe1reyWozbACP), [GQ2A9DtV…](https://explorer.testnet.near.org/transactions/GQ2A9DtvgvdLm71SenJs1NRMYGuuP6oLbD17uu2YnsKY) |

All transactions of the final run are in `results/demo-txs.json`, and every event in `results/demo-events.json`.

Be aware of what this run does and does not show:

- **The failed attacks have no transaction links.** The stranger's `approve_round` and the second `close_round` were rejected; the script confirmed each rejection but did not record the failed transaction hashes. The wrong-token deposit is a real transaction whose refund the script verified by balance.
- **The demo was resumed.** It was resumed three times after script bugs (CLI output parsing, a u64 argument, RPC timeouts), so the accounts, DAO and contract deployments were created in earlier attempts and are not in the list of the final run.
- **Vesting timing.** Efe's vesting read 37,500 after the cliff (month 18 on the demo clock) because the grant's clock started before the two board votes. That equals the engine's value for month 18. The script has since been fixed to start the clock after approval and to check the exact month-12 or month-13 value; that fix has **not** been re-run on testnet. One demo "month" lasts 5 seconds, a contract parameter.
- **Exercise on chain** is covered by the sandbox tests, not by the testnet demo.
- **Funding:** the testnet faucet rate-limited account creation, so some accounts were funded from earlier demo accounts.

`make demo` is the script that produced this run. It needs the `near` CLI (near-cli-rs), network access, and creates fresh throwaway testnet accounts through the public faucet; it spends no real money. Re-running it needs either a fresh suffix or `DEMO_SUFFIX=<old suffix>` to resume.

## How NEAR is used

- **Sputnik DAO** (testnet factory `sputnik-v2.testnet`) is the board. Approvals are ordinary FunctionCall proposals; the contract sees the DAO account as the caller. A 2-of-3 council needed two votes in the spike and the demo.
- **NEP-141** for payments: a self-deployed test USDC with a public faucet (no testnet USDC was used).
- **Named accounts** for every role, **NEP-297-style contract events**, and **plan hashes** (sha256 of RFC 8785 canonical JSON) that the board approves and the verifier recomputes.
- NEAR AI Cloud and NEAR Intents are **not** used. Cross-chain payment is described, not run, because NEAR Intents has no testnet.

## Simplifications and limits

- Not legal advice; no legal validity for any instrument.
- Simplified post-money SAFE: no MFN, no pro-rata side letters, no liquidity-event or dissolution mechanics beyond the exit waterfall. The cap-table and conversion definitions in RULES.md are my reading of the standard SAFE; **the SAFE clause citations in RULES.md are not written yet** because the YC document text has not been read.
- Preferred is 1x non-participating only; no convertible notes, participating preferred, pro-rata rights, transfers or confidential mode.
- Holdings, deposits and payouts are public on chain.
- The contract credits the issuances in the approved plan; it does not recompute the equity math. The safety argument is the board's approval of the plan hash plus anyone re-verifying with the engine.
- Payout receivers must already be registered with the token (NEP-145); otherwise their payout fails and stays retryable. `distribute` is capped per call by the contract constant `MAX_DISTRIBUTE` (an estimate, not a measured limit). Exercise strikes stay in the contract and are not forwarded to the treasury.
- The sandbox tests use a plain account as the board; the real DAO path was shown on testnet.
- Tested limits: legal validity, tax treatment, real-world SAFE edge cases and behaviour at scale are **not** tested.
- The Python reference was written by the same author (an AI assistant) in the same session, from RULES.md, using different algorithms; that is weaker than independent authorship.

## Prior art

Stated neutrally, from the projects' own pages (not independently verified):

- **Carta** and **Pulley**: off-chain cap-table products.
- **Obolos** (listed as a hackathon project on Arbitrum, live on Arbitrum Sepolia per its listing): on-chain cap table and share issuance, with confidential conversion described.
- **MetaLeX cyberCORPs**: onchain corporations whose stock ledger and issuance run on smart contracts, including SAFE-style fundraising with escrow, per MetaLeX's documentation.

What Rounds does differently: it is on NEAR, uses a DAO board that approves by plan hash, keeps the equity math in a small off-chain engine that anyone can re-run (with a second implementation and property tests), and ships a read-only verifier. It is a testnet demo, not a legal ownership ledger.

## Case against this idea

- *Why a blockchain at all?* Only for approvals and payouts that anyone can verify against a plan hash; the equity math itself stays off chain.
- *Why not Carta?* Carta works, is legally grounded and integrates with lawyers and banks. Rounds' pitch is cost and open, checkable records, which matters only if the record has legal standing, and this does not.
- *What is weak?* Public holdings (a real cap table is confidential), no legal status, simplified SAFE terms, and an off-chain engine whose correctness rests on tests, not proofs.
- *Why build it anyway?* The failure it targets is real: nobody can check a cap table. A reproducible engine, a board vote on a hash and a read-only verifier are a small, honest step toward fixing that.

## Hackathon disclosures

- **Code window:** all code in this repository was written starting 2026-11-06.
- **AI assistance:** the code, tests, specs and this README were written by Claude (Anthropic) through Claude Code, directed by the human team. The human reviews and submits.
- **Libraries:** near-sdk 5.30, near-workspaces 0.22, cargo-near 0.22, near-cli-rs 0.30, Sputnik DAO v2 (deployed from the testnet factory), TypeScript, Vitest, fast-check, Vite, Python standard library (fractions).
- **Other NEAR project by the same entrant:** _TODO for the human to fill in before submitting (none named so far)._
- **Inspiration:** the web app's look was modelled on resend.com's design tokens; no Resend code or assets are used.

## License

MIT, see [LICENSE](LICENSE).
