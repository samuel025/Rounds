# Full list of results and what each checks

Every number here is checked against `results/summary.json` by `make check-readme`.

[← back to the README](../README.md)

Every number below is checked against `results/summary.json` by `make check-readme`.

- The engine reproduces the golden vectors GV-1 (a Series A with two converting SAFEs) and GV-2 (an exit waterfall), plus hand-checked cases GV-3 (discount-only SAFE), GV-4 (options in and out of the money), GV-5 (cap wins, then discount wins), GV-6 (no pool top-up) and GV-7 (down round below the SAFE cap), and GV-8 (the shared payout of a $100,000 pot over the demo cap table). The expected values of GV-5 to GV-7 were derived on paper first (docs/NOTES.md). Vitest tests: <!--n:tests.engine-->152<!--/n--> passing, including <!--n:tests.properties-->11<!--/n--> property tests, input-guard regressions (zero price, empty cap table, invalid waterfall/vesting), exact BigInt money formatting, and the wallet-action tests (which run the real wallet-selector with a stand-in wallet).
- A second implementation in Python agrees with the TypeScript engine on <!--n:conformance.scenarios-->1000<!--/n--> seeded random scenarios (<!--n:conformance.mismatches-->0<!--/n--> mismatches; <!--n:conformance.rejected_inputs-->40<!--/n--> deliberately invalid inputs rejected by both).
- **Independence caveat:** the Python reference and the TypeScript engine were written by the same author in one session, so their agreement shows the code matches the rules in RULES.md, not that the rules are right. The anchors that do not depend on that author are the hand-derived vectors (GV-1/GV-2 from the brief, GV-5 to GV-7 worked on paper first) and the YC post-money SAFE clauses cited in RULES.md.
- Canonical JSON agrees byte for byte between the two implementations on <!--n:canonical.cases-->4<!--/n--> fixtures, including UTF-16 key order, unicode escaping and plan-shaped objects, and both compute the same SHA-256 (<!--n:canonical.mismatches-->0<!--/n--> mismatches). The Rust contract only hashes the bytes it receives, so it needs no canonicalizer.
- The Rust contract passes <!--n:tests.sandbox-->24<!--/n--> near-workspaces sandbox tests (a SAFT sold, converted by the contract's own arithmetic and claimed as it vests, with a wrong token count, a second conversion and more tokens than exist refused; token grants that cannot exceed the reserve, full round and exit, wrong-token refund, non-board approval, hash mismatch, double close, a proposal whose raise, kind or deadline differs from the hashed plan refused, a cancel with twelve depositors refunding everyone exactly once, a cancelled exit refunding its funders, two concurrent closes racing for the same SAFE, zero-raise/duplicate-investor/class-overwrite refusals, overlapping option grants not overcommitting the pool, a grant without a pool refused, a cancel racing a close never both refunding and forwarding, exact refunds, hostile token, failed-transfer retry, private callbacks, vesting and exercise, a large funded round, and a round whose plan cannot be credited being refused before any money moves). Escrow is forwarded to a separate treasury account, closing rounds reserve shares and SAFE ids until their callback, options exercise out of the unissued pool instead of minting, and exercise strikes are held separately until the board sweeps them.
- On **testnet**, a Series A with two converting SAFEs closed through a 2-of-3 Sputnik DAO vote and an exit paid every holder. The final demo run recorded <!--n:demo.transactions-->70<!--/n--> transactions and <!--n:demo.events-->33<!--/n--> contract events, and <!--n:demo.rounds_closed-->4<!--/n--> rounds closed.
- `make verify-onchain` (read-only) recomputes the demo from the engine and compares with the chain: <!--n:verify_onchain.checks-->31<!--/n--> checks, <!--n:verify_onchain.failed-->0<!--/n--> failed.
- `make replay` (no network) rebuilds the cap table and exit from committed events: <!--n:replay.checks-->11<!--/n--> checks, <!--n:replay.failed-->0<!--/n--> failed.


## The engine in brief

Rules are in [RULES.md](RULES.md); the code follows it. Shares are integers, money is integer micro-dollars, ratios are exact rationals (BigInt); there is no floating point. Every rounding remainder is reported, never silently dropped.

- **Post-money SAFE, cap only:** each SAFE gets exactly its purchase amount divided by its cap, of the capitalization just before the round. With a discount, it converts at the lower of the cap price and the discounted round price, solved by exact fixed-point iteration (fails loudly after 1,000 iterations).
- **Priced round:** the pool top-up sits in the pre-money, so it dilutes existing holders and SAFEs but not the new investor. Price = (pre-money − target × post-money) / (issued + SAFE shares), rounded down to 4 decimals.
- **Exit waterfall:** non-participating preferred takes its preference or converts, whichever pays more; ranks pay in order, pro rata within a rank; options exercise only above their strike.
- **Golden vectors** (`vectors/gv-1.json` to `vectors/gv-7.json`; GV-3 and GV-4 live in `test/`): GV-1 gives a $2.00 price, 15,000,000 fully diluted shares, Fund 4,500,000, SAFE 1 at $0.50 and SAFE 2 at $1.00. GV-2 at a $20M exit: Ada $6,111,111.11, Bayo $3,361,111.11, SAFE 1 $1,222,222.22, SAFE 2 $305,555.56, Fund $9,000,000.00.


## How NEAR is used

- **Sputnik DAO** (testnet factory `sputnik-v2.testnet`) is the board and the treasury. Approvals are ordinary FunctionCall proposals; the contract sees the DAO account as the caller. In step 10 the DAO also spends its own treasury through a FunctionCall proposal on the token (`ft_transfer_call` with the 1 yoctoNEAR a NEP-141 transfer needs). A 2-of-3 council needed two votes in the spike and the demo.
- **NEP-141** for payments: a self-deployed test USDC with a public faucet (no testnet USDC was used).
- **Named accounts** for every role, **NEP-297-style contract events**, and **plan hashes** (sha256 of RFC 8785 canonical JSON) that the board approves and the verifier recomputes.
- NEAR AI Cloud and NEAR Intents are **not** used. Cross-chain payment is described, not run, because NEAR Intents has no testnet.
