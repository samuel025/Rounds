# Rounds — a cap table on NEAR that shows its work

> **Not legal or financial advice.** Rounds is a model and a **NEAR testnet demo**, not a securities offering. It claims no legal validity for any instrument. All money is a test token with no value. Holdings on the demo contract are **public on chain**. Built at NEAR HACKATHON (Nov 2026).

Cap tables live in spreadsheets and PDFs, and nobody can check them. Rounds is a cap-table tool where a pure, exact equity engine does the math (common and preferred shares, option pool, post-money SAFEs, priced rounds with pool top-up, vesting, exit waterfall), a Sputnik DAO board approves each round and exit **by plan hash**, and anyone can re-verify the result against the chain.

## Why this matters

When a startup raises money, one spreadsheet says who owns what: founders, investors and employees' stock options. It is usually a private file, and it goes wrong in familiar ways: different people compute different numbers, an investor cannot check that what they were promised is what was recorded, and nobody can prove afterwards that a payout at a sale followed the agreed rules.

Rounds makes the math checkable:

1. **One set of exact rules.** [RULES.md](RULES.md) defines every number (share price, SAFE conversion, option pool, exit payouts). The engine follows it with exact integer arithmetic and reports every rounding remainder.
2. **An approval that cannot be swapped.** A round is written as a plan with a SHA-256 fingerprint. The company's board (a DAO vote on NEAR) approves that fingerprint, and the contract refuses to run any plan that does not match it. Investor money sits in escrow until the board approves.
3. **Anyone can re-check.** An investor, employee or board member can recompute the plan in their own browser and compare it with the chain (the app's Verify button).

Who it is for: a **founder** modelling and running a round; an **investor** verifying the shares they paid for; an **employee** checking vesting and exit value; a **board member** approving one exact plan.

## How another person can use it today

This is a hackathon prototype on NEAR **testnet**: fake money only. The app connects a NEAR **testnet** wallet (wallet-selector: MyNearWallet, Meteor) to sign real testnet transactions. The app is a static site (`vercel.json` builds it on Vercel from this repo) and reads the testnet contract directly from the chain. Three levels of use:

1. **Look and verify.** Open the app, click **Verify**, or paste any Rounds contract account into the box under Events & verify. To run it yourself (about five minutes, no accounts): `git clone`, `npm install`, `make web-dev`, open the local address. Click **Verify** to check the live testnet contract. `make replay` (offline) and `make verify-onchain` (read-only) check the committed demo run.
2. **Run your own test round.** Install the `near` CLI (near-cli-rs) and run `make demo`. It creates throwaway testnet accounts, a 2-of-3 board DAO, a test token and the Rounds contract, then runs the rounds, three attacks and an exit.
3. **Use it for a real company: not possible yet.** It would need a mainnet deployment (deliberately not done), and legal documents. A SAFE and a share issuance are legal acts that Rounds does not replace.

## Headline results

Every number below is checked against `results/summary.json` by `make check-readme`.

- The engine reproduces the golden vectors GV-1 (a Series A with two converting SAFEs) and GV-2 (an exit waterfall), plus hand-checked cases GV-3 (discount-only SAFE), GV-4 (options in and out of the money), GV-5 (cap wins, then discount wins), GV-6 (no pool top-up) and GV-7 (down round below the SAFE cap). The expected values of GV-5 to GV-7 were derived on paper first (docs/NOTES.md). Engine tests: <!--n:tests.engine-->25<!--/n--> passing, including <!--n:tests.properties-->9<!--/n--> property tests.
- A second implementation in Python agrees with the TypeScript engine on <!--n:conformance.scenarios-->1000<!--/n--> seeded random scenarios (<!--n:conformance.mismatches-->0<!--/n--> mismatches; <!--n:conformance.rejected_inputs-->40<!--/n--> deliberately invalid inputs rejected by both).
- The Rust contract passes <!--n:tests.sandbox-->6<!--/n--> near-workspaces sandbox tests (full round and exit, wrong-token refund, non-board approval, hash mismatch, double close, exact refunds, hostile token, failed-transfer retry, private callbacks, vesting and exercise).
- On **testnet**, a Series A with two converting SAFEs closed through a 2-of-3 Sputnik DAO vote and an exit paid every holder. The final demo run recorded <!--n:demo.transactions-->57<!--/n--> transactions and <!--n:demo.events-->23<!--/n--> contract events, and <!--n:demo.rounds_closed-->4<!--/n--> rounds closed.
- `make verify-onchain` (read-only) recomputes the demo from the engine and compares with the chain: <!--n:verify_onchain.checks-->21<!--/n--> checks, <!--n:verify_onchain.failed-->0<!--/n--> failed.
- `make replay` (no network) rebuilds the cap table and exit from committed events: <!--n:replay.checks-->8<!--/n--> checks, <!--n:replay.failed-->0<!--/n--> failed.

## Try it

| Do this | See this |
|---|---|
| `npm install && make test` | Engine tests and properties pass, then the Python conformance prints `"mismatches": 0` |
| `make replay` | Offline: the step list with transaction links, the rebuilt cap table, the exit payouts, and a last line `PASS summary: … 0 failed` |
| `make verify-onchain` | Read-only, needs network: every line starts with `PASS`; the last line ends with `0 failed` |
| `make test-contract` | Builds the contract and mock token, then the sandbox tests pass (about a minute; downloads the sandbox binary the first time) |
| `make web-dev` | The app on a local port: dilution chart, cap table, round modeler, investor and employee views, exit simulator, events and Verify. `make web` builds a static site into `dist/`. The repo includes a `vercel.json`, so connecting it to Vercel builds and hosts the app. |
| `make demo` | Scripted testnet run (needs `near` CLI, network and the faucet; see the note below) |
| `make e2e-wallet` | needs `make web-dev` running, the `near` CLI, Chrome and the throwaway demo keys on this machine: drives the app's real wallet buttons against testnet with a test signer; last line `PASS summary: <n> checks, 0 failed` |
| `make check-readme` | Fails if a number in this README differs from `results/summary.json` |

**Wallet.** "Connect wallet" (top right) lets you sign real testnet transactions; no access key is requested, so every action opens your wallet for approval. What each action needs:

| Action in the app | Who can do it |
|---|---|
| Register for the test token and mint a fixed amount from its public faucet | any testnet account |
| Deposit into a round's escrow | the investor named in that round's raise |
| Close an approved, funded round; pay out an approved exit | anyone |
| Approve a board proposal | a member of that contract's board DAO |
| Propose the modeled round (`propose_round`, with your account as investor) | an officer of that contract |

Buttons your account cannot use are shown disabled or answered with the contract's own refusal message. On the committed demo contract the board, officers and investors are throwaway demo accounts, so a visitor can use the faucet and see refusals but cannot vote or propose there; to try the full flow, deploy your own sandbox with `make demo`. "Run exit" in the modeler is a simulation; the on-chain exit is the "Pay out" button above. The Verify button reads the live contract named in `web/public/deployment.json`.

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
| Rounds contract | `rounds-core-052090.testnet` |
| Board (Sputnik DAO v2.0.0, 2-of-3 council) | `rounds-board-052090.sputnik-v2.testnet` |
| Test USDC (6 decimals, public faucet) | `rounds-usdc-052090.testnet` |

| Demo step | Key transaction |
|---|---|
| DAO board created (2-of-3 council) | [Frxub4Ep…](https://explorer.testnet.near.org/transactions/Frxub4EpmcLzKRhfMz4PE5a67vZ8uk9HFUBYCfWv3peF) |
| Founders and pool closed (after a board vote) | [4EGkrJuJ…](https://explorer.testnet.near.org/transactions/4EGkrJuJ6DfoXdkBskvZr7jerjLwu7DLPz6wsd8FHR6R) |
| SAFE 1 closed, SAFE 2 closed | [F7LtPCu6…](https://explorer.testnet.near.org/transactions/F7LtPCu6FNjhuxibxYc324aKyNYMjyBhkCXs1ccQMZrh), [7r8cfcGR…](https://explorer.testnet.near.org/transactions/7r8cfcGRutnoaXsjinhomdRSNrtanXVuMrxdo2tFMaqk) |
| Fund pays $9,000,000 into escrow | [87fHfShf…](https://explorer.testnet.near.org/transactions/87fHfShfPqeM27x76rqCEsv2zRNQ1PJyQTZQLWU9kwwX) |
| Series A closed, holdings credited | [2e6T7saS…](https://explorer.testnet.near.org/transactions/2e6T7saSYGhTrhQmCdr5pz3etab5MUmL4L3NuzcSxzoS) |
| Attack: a stranger calls `approve_round` (**fails on chain**: only the board) | [7Zqxt28B…](https://explorer.testnet.near.org/transactions/7Zqxt28BLWyag7Tk5ABUGuADrJJNrmBMtBkuKrHnndb9) |
| Wrong-token deposit (refunded in full) | [tnqvmdcE…](https://explorer.testnet.near.org/transactions/tnqvmdcE3oNWYuaiKWLqvc6mHXZca5yLn9ZGKSvXTWD) |
| Attack: `close_round` a second time (**fails on chain**: already closing/closed) | [GQqAyzex…](https://explorer.testnet.near.org/transactions/GQqAyzexEEJ1YFeu2mSWNwGxnZDwfUwQTfz5YZEJbQfJ) |
| Board executes the option grant for Efe | [Guwiz3eW…](https://explorer.testnet.near.org/transactions/Guwiz3eWhDpEDQCU9MbcB5M6bLGbHLsRzSCpkVYiXRP4) |
| Zed funds the $20M exit; board approves; distribute | [EadSjTmj…](https://explorer.testnet.near.org/transactions/EadSjTmjWVJmV3vDgzUA6WwwoawifQwHFGSSA1nct5is), [4qCL2hpB…](https://explorer.testnet.near.org/transactions/4qCL2hpBZvSkc81M7c2W11UHQLtojeSkSRppN8Wq5DHK), [B1V9GV2W…](https://explorer.testnet.near.org/transactions/B1V9GV2WYS2RTfvHcLRri2ctMMwDAmUMkmK3mgTgVKqz) |

All transactions of the final run are in `results/demo-txs.json`, and every event in `results/demo-events.json`.

Be aware of what this run does and does not show:

- **The failed attacks are on chain.** The demo signs each hostile call, broadcasts it over RPC itself, and requires the transaction to fail with the contract's own message; `make verify-onchain` re-reads both transactions from the chain and checks that they failed. The wrong-token deposit is a separate, successful transaction whose refund the script verified by balance.
- **This run was resumed twice**, because the testnet faucet is rate-limited and the leftover test NEAR of earlier runs had to be pieced together (`DEMO_FUND_FROM`). The first attempt stopped while funding accounts and a second stopped while funding the last one; nothing had been deployed or run by then, and the full demo then ran from start to finish in one go. Earlier runs (suffixes `012465`, `372231`) also exist on testnet and are superseded.
- **Vesting.** The script reads the contract's `vested` view at a specific block whose timestamp is 12.15 demo "months" after the grant start (the block is pinned, so a slow script cannot read a later month) and requires exactly the engine's month-12 value: 25,000 of 100,000. One demo "month" lasts 5 seconds, a contract parameter.
- **RPC.** The old public endpoint `rpc.testnet.near.org` now rejects requests as deprecated, so the app, the demo and `make verify-onchain` use FastNear (`test.rpc.fastnear.com`; old transactions via `archival-rpc.testnet.fastnear.com`). Both can be overridden with `RPC_URL` and `ARCHIVAL_RPC_URL`.
- **Exercise on chain** is covered by the sandbox tests, not by the testnet demo.

`make demo` is the script that produced this run. It needs the `near` CLI (near-cli-rs), network access, and creates fresh throwaway testnet accounts through the public faucet (or a previous run's leftovers); it spends no real money. Each run creates fresh accounts; set `DEMO_SUFFIX=<suffix>` to resume a partly finished run, or `DEMO_FUND_FROM=<old suffix>` to fund the new accounts from a previous run's accounts when the faucet refuses.

## How NEAR is used

- **Sputnik DAO** (testnet factory `sputnik-v2.testnet`) is the board. Approvals are ordinary FunctionCall proposals; the contract sees the DAO account as the caller. A 2-of-3 council needed two votes in the spike and the demo.
- **NEP-141** for payments: a self-deployed test USDC with a public faucet (no testnet USDC was used).
- **Named accounts** for every role, **NEP-297-style contract events**, and **plan hashes** (sha256 of RFC 8785 canonical JSON) that the board approves and the verifier recomputes.
- NEAR AI Cloud and NEAR Intents are **not** used. Cross-chain payment is described, not run, because NEAR Intents has no testnet.

## Simplifications and limits

- Not legal advice; no legal validity for any instrument.
- Simplified post-money SAFE: no MFN, no pro-rata side letters, no liquidity-event or dissolution mechanics beyond the exit waterfall. RULES.md now maps each SAFE rule to the clause in the YC post-money forms (Valuation Cap Only, Discount Only, MFN Only; downloaded 2026-11-07). Three things go beyond or differ from those forms: a SAFE with both a cap and a discount is Rounds' own extension, Promised Options are not modelled, and exits before a SAFE converts are not modelled. The mapping is not legal advice.
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
- **Other NEAR project by the same entrant:** none. Rounds is the only project entered.
- **Inspiration:** the web app's look was modelled on resend.com's design tokens; no Resend code or assets are used.

## License

MIT, see [LICENSE](LICENSE).
