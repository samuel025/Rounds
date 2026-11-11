# Rounds — a confidential cap table that a Sputnik DAO approves to the exact number

> **Not legal or financial advice.** Rounds is a model and a **NEAR testnet demo**, not a securities offering, and claims no legal validity for any instrument. All money is a test token with no value. Built at NEAR HACKATHON (Nov 2026).

**Live app: https://roundcap.vercel.app** (NEAR testnet, play money; it reads the chain directly, nothing runs on a server). Code: https://github.com/samuel025/Rounds. Demo video: [`demo/rounds-demo.mp4`](demo/rounds-demo.mp4).

**In 30 seconds.** A real cap table is private, but a group that decides things with a Sputnik DAO still needs its vote to mean something exact. Rounds does both. Every change (who puts in how much, who gets how many shares, who is paid what) is an exact plan with a SHA-256 fingerprint; the money waits in escrow; the DAO votes on the fingerprint; and the contract only runs a plan that hashes to what was approved.

- **Confidential mode (zero-knowledge, optional):** the chain stores only a sealed fingerprint of the cap table plus a Groth16 proof that it adds up. No holding appears on chain, the DAO's board checks the private table before approving, and a holder claims a payout with a proof that does not say which row is theirs, paid to a brand-new account if they like.
- **Transparent mode (default):** the full feature set with holdings on chain: priced rounds, converting SAFEs, vesting, exits, SAFT token conversion, and a shared pot paid pro rata. Anyone can recompute any plan in their own browser (**Verify**), and four attacks are shown failing on chain (`make verify-onchain` re-checks them).

**Demo video:** [`demo/rounds-demo.mp4`](demo/rounds-demo.mp4) (4 minutes, recorded 2026-11-11, narrated in plain language). It opens with a 15 second fly-over of the live page (made by `scripts/intro-film`), then shows the **confidential mode** on its testnet sandbox: the private cap table built and proved in the browser, the board's check (the right copy passes, a table with one number changed is refused), a private payout, and a claim paid to a brand-new account through a relayer. Then the transparent mode: the round modeler, the guided round, a shared payout, the in-browser hash re-check, and the board proposals card. Waiting for the chain is cut out of the video. It was recorded in three parts on different testnet sandboxes by `scripts/record-demo.mjs` (confidential, transparent, and the closing read-only part), joined with ffmpeg, so account names differ between parts; the confidential claim in the video goes through a relayer that was run locally (the live site has none, so there the holder's wallet signs the claim). The token-sale (SAFT) scene of the earlier cut is not in this one; it is covered by `make verify-tokens`.

**What a community does with it** (the Social Money track asks for what groups do with a DAO, not another multisig):

| The group wants to | In Rounds | Shown where |
|---|---|---|
| Pool money for a shared venture | Members deposit into escrow per round; refunded if the round is cancelled | demo steps 3 to 5, sandbox test `cancel_with_many_investors_refunds_everyone` |
| Agree who owns what | The DAO approves one plan hash that fixes the shares **and** the money paid for them | demo steps 2 to 5, sandbox test `plan_hash_binds_raise_kind_and_deadline` |
| Reward contributors over time | Vesting grants that are claims on a shared pool, exercised on chain | demo steps 7 and 9 |
| Pay everyone their share | A DAO-approved payout list that the contract pays out, each holder once; and a shared pot paid pro rata by shares from the DAO's own treasury (RULES.md R10) | demo steps 8 and 10 (`make distribute`), the app's "Share a pot" card, and a card where **any visitor can run a shared payout on a sandbox** (below) |
| Know what you are voting on | Every board proposal decoded in the app: its hash is recomputed in your browser against the plan the contract holds, and the change is shown as numbers (who pays what, shares, price, ownership after) before you press Approve | app: Events & verify, "Board proposals" |
| Let any member check all of it | Read-only verifier in the browser and `make verify-onchain` | Verify button |

The board is an unmodified Sputnik DAO v2 created from the testnet factory: every approval is an ordinary `FunctionCall` proposal on an account the contract treats as its board, so in principle any Sputnik DAO can be the board without changes. **Trezu was looked up, not used.** From its repository and third-party write-ups, Trezu (NEAR DevHub) is a treasury manager whose treasuries are Sputnik DAOs created by the mainnet factory; it covers payments, bulk payments, vesting and cross-chain transfers. I could not confirm that it supports testnet, opening a DAO it did not create, or custom contract calls such as `approve_round`, and its treasuries are reported to run a newer Sputnik contract than the v2.0.0 used here. So Rounds has not been run through Trezu's UI, and the demo does not claim to: the proposals and votes are sent with the `near` CLI, and the app's Board proposals card reads any Sputnik DAO directly.

**Why a blockchain, and not a spreadsheet or a database?** Because the thing worth proving is *"the board approved exactly these numbers, and the money moved only under that approval"*, and that must hold even if the company, an investor or the operator later disagrees. A private cap table cannot prove that to a third party; a contract that holds the escrow, checks the hash and pays out can. The equity math itself stays off chain (it is exact, open and re-checkable). The chain is used only for what needs a neutral referee: approval by hash, custody, and payouts. Rounds is aimed at groups that already govern on-chain with a DAO (an investment club, a contributor collective, a crypto-native startup); it is not a replacement for a cap-table service for an ordinary private company.

Crypto-native startups, and the groups that fund them, often raise money with SAFEs and similar notes and make decisions on-chain, yet the ownership table is still a spreadsheet, and a board's "yes" cannot be tied to the exact numbers it approved. Rounds shows how that can work, built on NEAR testnet. Every funding round becomes an exact plan with a fingerprint (a SHA-256 hash); investors' money waits in escrow; the board (a Sputnik DAO) approves that fingerprint, and the contract only runs a plan that matches it; payouts at an exit are paid out automatically. A pure, exact equity engine does the math (common and preferred shares, option pool, post-money SAFEs, priced rounds with pool top-up, vesting, exit waterfall), and anyone can re-verify any round in their own browser against the chain. It models equity on chain and in the app. SAFTs and token warrants are handled too, with a project token, a token reserve and vesting token grants (see "Tokens and SAFTs").

## Why this matters

*New to cap tables? The page opens with a plain-English box and a glossary (cap table, SAFE, Series A, option pool, plan hash and the rest).*

Take a crypto startup that raises from several investors. Ownership lives in a private spreadsheet and goes wrong in familiar ways: different people compute different numbers, an investor cannot check that what they were promised is what was recorded, and when the board votes "yes" to a round, nobody can prove afterwards exactly which numbers it approved. Teams that already govern on-chain may find a verifiable record a natural fit, but that demand is unvalidated here, and similar on-chain cap-table products already exist. Rounds is not a replacement for a conventional cap-table service for a private company: holdings here are public, it models equity only, and it is a testnet demo.

Rounds makes the math checkable:

1. **One set of exact rules.** [RULES.md](RULES.md) defines every number (share price, SAFE conversion, option pool, exit payouts). The engine follows it with exact integer arithmetic and reports every rounding remainder.
2. **An approval that cannot be swapped.** A round is written as a plan with a SHA-256 fingerprint. The plan holds the shares to issue and the money terms (the kind of round, who pays how much, the funding deadline), and the contract refuses a proposal whose terms differ from the ones inside the hashed plan. The group's board (a DAO vote on NEAR) approves that fingerprint, and the contract refuses to run any plan that does not match it. Investor money sits in escrow until the board approves.
3. **Anyone can re-check.** An investor, employee or board member can recompute the plan in their own browser and compare it with the chain (the app's Verify button).

Who it is for: a **founder or contributor** modelling and running a round; an **investor** verifying the shares they paid for; a **team member** checking vesting and exit value; a **board member** approving one exact plan.

## Deploying the app (Vercel)

The app is a static site. `vercel.json` already sets the install command, the build command (`node scripts/rules-html.mjs && npx vite build`), the output folder (`dist`) and security headers, and `.vercelignore` keeps the upload small. Import the GitHub repository in Vercel and press Deploy (no environment variables are needed), or run `vercel --prod` from the repository root. A clean clone with only the files the build needs was built to check this. It reads the testnet chain directly from the visitor's browser.

## How another person can use it today

Rounds is built on NEAR **testnet**: fake money only. The app connects a NEAR **testnet** wallet (wallet-selector: MyNearWallet, Meteor) to sign real testnet transactions. The app is a static site (`vercel.json` builds it on Vercel from this repo) and reads the testnet contract directly from the chain. Three levels of use:

1. **Look and verify.** Open the [live app](https://roundcap.vercel.app), click **Verify**, or paste any Rounds contract account into the box under Events & verify. To run it yourself (about five minutes, no accounts): `git clone`, `npm install`, `make web-dev`, open the local address. Click **Verify** to check the live testnet contract. `make replay` (offline) and `make verify-onchain` (read-only) check the committed demo run.
2. **Run your own test round.** Install the `near` CLI (near-cli-rs) and run `make demo`. It creates throwaway testnet accounts, a 2-of-3 board DAO, a test token and the Rounds contract, then runs the rounds, four attacks and an exit.
3. **Use it for a real company: not possible yet.** It would need a mainnet deployment (deliberately not done), and legal documents. A SAFE and a share issuance are legal acts that Rounds does not replace.

## Confidential cap tables (zero-knowledge mode)

**A cap table is private; the approval should still be exact.** Confidential mode keeps every holding off the chain while the DAO still approves one exact, checkable plan. It is a separate card in the app (live testnet sandbox), next to the transparent mode below.

**What it does.** A round can keep its cap table private. The chain stores a Poseidon Merkle root, the total shares and the raise, plus a zero-knowledge proof (Groth16 over BN254, checked by the contract with NEAR's `alt_bn128` functions) that the private table adds up to that total. A later payout is a **private payout**: the DAO funds a pot and approves it, then each holder uses a **receipt** (a file only they have) to prove, in their own browser, that they are in the committed table and are owed exactly `floor(shares × pot ÷ total shares)`, and names any fresh account to receive it.

| Stays private | Stays public |
|---|---|
| Every individual holding | The total raise and **who paid it** (deposits are ordinary token transfers) |
| Which holder is behind which payout (the proof does not say which leaf is theirs; a spent leaf is marked by a one-time nullifier) | The total shares, the committed root, the payout pot |
| Each holder's own key, which never leaves their device (the proposer only sees a public code) | **The amount of every payout.** It follows from the pot and the total shares, so a payout reveals roughly how big the holder's stake is. This mode hides *who*, not *how much*. |
| | The account that signs a claim. With a relayer it is the relayer's, not yours (the relayer operator sees your network address); without one, a claim signed by your own wallet is linked to you. |

**Parts.**
- `circuits/cap_table_commit.circom` (38,225 constraints): every share amount is a 64-bit number, the amounts sum to the public total, the 64 leaves hash to the public root, bound to a round id. `circuits/private_claim.circom` (2,723 constraints): Merkle membership, the nullifier `Poseidon(holder_secret, exit_id)`, the exact floor-division payout, and a binding to the recipient, so a proof copied by someone else for another account fails.
- `contract/src/zk.rs`: a self-contained Groth16 verifier. New contract methods: `propose_confidential_round` (verifies the proof before accepting the round), `propose_private_exit`, `approve_private_exit`, `claim_private_payout`, with the nullifier recorded **before** the transfer and restored if the transfer fails. The confidential round goes through the ordinary board approval by plan hash, deposits and close.
- `src/engine/zk.ts`: holder keys, the table builder, claim files, the board's table check, the encrypted board copy, and the in-browser provers. The page has one **Confidential mode (ZK)** card with two tabs: tab 1 builds, proves and proposes a confidential round (and offers the claim files, the demo holder keys, the table file for the board and the encrypted board copy) and holds the **Board check**; tab 2 opens, funds and approves a private payout and holds the **Private claim** panel (holder key + claim file + any fresh account, optionally through a relayer).
- **Holders own their keys.** Each holder creates their own secret on their own device (the page's "Create my holder key") and gives the proposer only a public code derived from it. The table is built from those codes, so the proposer never holds anything that can claim a payout. What a holder needs besides the key is a **claim file**: their position in the committed table. It holds no secret, and any claim file can be re-issued from the table file, so a lost claim file is not a lost claim (a lost holder *key* still is). One key per holder **and class** keeps nullifiers distinct (the first draft shared one secret and would have allowed only one claim per holder). In the page's demo flow the tab creates every holder's key itself so it can run alone.
- **The board can check a sealed round.** The proposer gives the board the private **table file**, or an **encrypted board copy** (AES-GCM, protected by a passphrase the proposer gives the board; its hash can be committed inside the round, so it cannot be swapped or withheld after approval). The page's **Board check** re-seals the table in the browser and compares it with the root and total on chain, reports the shares by class, and lists every problem (a changed number, a different total, a duplicated holder code). It proves the file is the table the root came from; it cannot prove every row is a real person, which stays the board's judgement.
- **Claims need no visible wallet.** The contract registers the claim's recipient with the payment token itself (`registration_deposit`, set by the board: 0 for the test token, about 0.00125 NEAR for a real NEP-141 token), so the holder never sends a registration transaction. A **relayer** (`relayer/claim.mjs`, run locally with `make relayer` or deployed as the Vercel function `api/relay-claim.js`) takes the holder's proof, verifies it off chain first (an invalid proof costs nothing), checks that the receipt is unclaimed, and submits it from its own account, paying the gas.

**Evidence.**
- `npx vitest run test/zk.test.ts`: the real circuits prove valid tables and claims, and the prover refuses a wrong total, a share amount over 64 bits or wrapping the field, a wrong Merkle path, a wrong secret and a forged amount; proofs do not verify for another recipient, payout, nullifier, exit or root.
- `make test-contract` (contract tests `contract/it/tests/zk_sandbox.rs`): a confidential round with a valid proof, DAO approval, a funded private exit, and claims to brand-new accounts; plus tampered proof bytes, a proof for another total or root, a proof opened for another round, a replayed nullifier (`ERR_NULLIFIER_USED`), a valid proof front-run with another recipient (`ERR_INVALID_PROOF`), a wrong payout, an unapproved payout, a failed transfer that restores its nullifier, an unregistered recipient registered by the contract, and an encrypted-copy commitment inside the plan the board approves (a malformed one is refused). A deliberate bug that made the verifier accept everything makes this test fail.
- `make e2e-zk` (output in `results/e2e-zk.txt`): drives the page's buttons with the test signer on a testnet confidential sandbox (`rsbx-zkrounds-556554.testnet`, `web/public/zk-sandbox.json`) and a local relayer: builds the private table, encrypts the board copy and proves the table in the browser, proposes it with the copy's hash committed in the plan, runs the **Board check** (the right copy passes; a table with one number changed and a wrong passphrase are refused), funds, approves and closes the round, opens, funds and approves a private payout, then claims with a holder's own key and claim file **through the relayer to a brand-new account that was never registered with the token** (the contract registers it). It checks that the holder's wallet signed nothing for the claim, that the account received exactly the pro-rata share, and that claiming again is refused (`ERR_NULLIFIER_USED`). Every check passed on 2026-11-11. It has not been run with a real wallet.

**Scope and limits.**
- **Trusted setup.** `make circuits` runs a Powers of Tau and a Groth16 setup with **one contributor (this machine)**. Anyone who knew that randomness could forge proofs, so this is a development setup for testnet play money. A real deployment needs a multi-party ceremony.
- **The board still approves a root, not numbers.** The Board check lets it re-seal the private table it was given and compare, but nothing in the proofs stops a proposer from including a row for a holder who does not exist; a board should have each real holder confirm their own claim file.
- **At most 64 table slots.** A lost holder key is a lost claim (a lost claim file is not). The encrypted board copy is protected only by a passphrase, and anyone who has the file and the passphrase can open it.
- Verification needs about 120 Tgas attached to a claim and 100 Tgas to propose a round. The relayer is a service you must run and fund; the repository ships it but does not run one, and the Vercel function needs `RELAYER_ACCOUNT`, `RELAYER_PRIVATE_KEY` (a throwaway funded testnet key) and `RELAYER_CONTRACT` set, plus `web/public/relayer.json` pointing to it.
- The proving keys are about 39 MB (the page downloads them when you prove) and are committed on this branch under `web/public/zk/`.
- Not covered: confidential deposits and payments (token transfers are public), SAFTs and token grants in confidential rounds, and any confidential exit other than the pro-rata payout.

## Headline results

Every number below is checked against `results/summary.json` by `make check-readme`.

- The engine reproduces the golden vectors GV-1 (a Series A with two converting SAFEs) and GV-2 (an exit waterfall), plus hand-checked cases GV-3 (discount-only SAFE), GV-4 (options in and out of the money), GV-5 (cap wins, then discount wins), GV-6 (no pool top-up) and GV-7 (down round below the SAFE cap), and GV-8 (the shared payout of a $100,000 pot over the demo cap table). The expected values of GV-5 to GV-7 were derived on paper first (docs/NOTES.md). Vitest tests: <!--n:tests.engine-->77<!--/n--> passing, including <!--n:tests.properties-->11<!--/n--> property tests, input-guard regressions (zero price, empty cap table, invalid waterfall/vesting), exact BigInt money formatting, and the wallet-action tests (which run the real wallet-selector with a stand-in wallet).
- A second implementation in Python agrees with the TypeScript engine on <!--n:conformance.scenarios-->1000<!--/n--> seeded random scenarios (<!--n:conformance.mismatches-->0<!--/n--> mismatches; <!--n:conformance.rejected_inputs-->40<!--/n--> deliberately invalid inputs rejected by both).
- **Independence caveat:** the Python reference and the TypeScript engine were written by the same author in one session, so their agreement shows the code matches the rules in RULES.md, not that the rules are right. The anchors that do not depend on that author are the hand-derived vectors (GV-1/GV-2 from the brief, GV-5 to GV-7 worked on paper first) and the YC post-money SAFE clauses cited in RULES.md.
- Canonical JSON agrees byte for byte between the two implementations on <!--n:canonical.cases-->4<!--/n--> fixtures, including UTF-16 key order, unicode escaping and plan-shaped objects, and both compute the same SHA-256 (<!--n:canonical.mismatches-->0<!--/n--> mismatches). The Rust contract only hashes the bytes it receives, so it needs no canonicalizer.
- The Rust contract passes <!--n:tests.sandbox-->18<!--/n--> near-workspaces sandbox tests (a SAFT sold, converted by the contract's own arithmetic and claimed as it vests, with a wrong token count, a second conversion and more tokens than exist refused; token grants that cannot exceed the reserve, full round and exit, wrong-token refund, non-board approval, hash mismatch, double close, a proposal whose raise, kind or deadline differs from the hashed plan refused, a cancel with twelve depositors refunding everyone exactly once, a cancelled exit refunding its funders, two concurrent closes racing for the same SAFE, zero-raise/duplicate-investor/class-overwrite refusals, overlapping option grants not overcommitting the pool, a grant without a pool refused, a cancel racing a close never both refunding and forwarding, exact refunds, hostile token, failed-transfer retry, private callbacks, vesting and exercise, a large funded round, and a round whose plan cannot be credited being refused before any money moves). Escrow is forwarded to a separate treasury account, closing rounds reserve shares and SAFE ids until their callback, options exercise out of the unissued pool instead of minting, and exercise strikes are held separately until the board sweeps them.
- On **testnet**, a Series A with two converting SAFEs closed through a 2-of-3 Sputnik DAO vote and an exit paid every holder. The final demo run recorded <!--n:demo.transactions-->70<!--/n--> transactions and <!--n:demo.events-->33<!--/n--> contract events, and <!--n:demo.rounds_closed-->4<!--/n--> rounds closed.
- `make verify-onchain` (read-only) recomputes the demo from the engine and compares with the chain: <!--n:verify_onchain.checks-->31<!--/n--> checks, <!--n:verify_onchain.failed-->0<!--/n--> failed.
- `make replay` (no network) rebuilds the cap table and exit from committed events: <!--n:replay.checks-->11<!--/n--> checks, <!--n:replay.failed-->0<!--/n--> failed.

## Try it

| Do this | See this |
|---|---|
| `npm install && make test` | Engine tests and properties pass, then the Python conformance prints `"mismatches": 0` |
| `make e2e-zk` | Needs `make web-dev` running, the near CLI, Chrome and the confidential sandbox's keys: drives the Confidential mode card on testnet (private table, in-browser proof, Board check, private payout, claim to a brand-new account); last line `PASS summary: … 0 failed` |
| `make replay` | Offline: the step list with transaction links, the rebuilt cap table, the exit payouts, and a last line `PASS summary: … 0 failed` |
| `make verify-onchain` | Read-only, needs network: every line starts with `PASS`; the last line ends with `0 failed` |
| `make distribute` | Demo step 10, run after `make demo` (needs the `near` CLI, network and the demo accounts' keys; once per deployment): the DAO treasury shares a $100,000 pot with every shareholder pro rata, checks every payout against the engine, and appends to `results/` |
| `make test-contract` | Builds the contract and mock token, then the sandbox tests pass (a few minutes; downloads the sandbox binary the first time) |
| `make tokens` / `make verify-tokens` | Demo step 11 on testnet (needs the `near` CLI, the demo accounts' keys and about 8 testnet NEAR from old demo accounts via `TOKENS_FUND_FROM`; once per deployment), then its read-only re-check |
| `make web-dev` | The app on a local port: dilution chart, cap table, round modeler, investor and employee views, exit simulator, events and Verify. `make web` builds a static site into `dist/`. The repo includes a `vercel.json`, so connecting it to Vercel builds and hosts the app. |
| `make demo` | Scripted testnet run (needs `near` CLI, network and the faucet; see the note below) |
| `make sandbox` | `near` CLI, network, faucet or spare testnet NEAR (`SANDBOX_FUND_FROM`): deploys a fresh open sandbox (founders and two SAFEs closed, Series A left to try) and adds it to the pool in `web/public/sandboxes.json` |
| `make e2e-wallet` | needs `make web-dev` running, the `near` CLI, Chrome and the throwaway demo keys on this machine: drives the app's real wallet buttons against testnet with a test signer (with `E2E_SANDBOX=<a throwaway sandbox instance>` it also plays all eight guided steps and checks that the page height stays stable); last line `PASS summary: <n> checks, 0 failed` |
| `make e2e-share` | needs `make web-dev` running, the `near` CLI, Chrome and a sandbox's throwaway keys: drives the "Share a pot" run card through the app's real buttons with the DEV-only test signer; last line `PASS summary: <n> checks, 0 failed`. Writes testnet transactions and leaves one paid payout on the sandbox; it does not use up the sandbox |
| `make check-readme` | Fails if a number in this README differs from `results/summary.json` |

**Wallet.** "Connect wallet" (top right) lets you sign real testnet transactions; no access key is requested, so every action opens your wallet for approval. What each action needs:

| Action in the app | Who can do it |
|---|---|
| Register for the test token and mint a fixed amount from its public faucet | any testnet account |
| Deposit into a round's escrow | the investor named in that round's raise |
| Close an approved, funded round; pay out an approved exit | anyone |
| Approve a board proposal (Sputnik DAO board) | a member of that contract's board DAO |
| Make yourself an officer; approve a round as the board (open sandbox only) | any testnet account |
| Propose the modeled round (`propose_round`, with your account as investor) | an officer of that contract |

Buttons your account cannot use are shown disabled or answered with the contract's own refusal message. On the committed **demo contract** the board, officers and investors are throwaway demo accounts, so a visitor can use the faucet and see refusals but cannot vote or propose there.

**Run a shared payout yourself.** On the open sandbox the **Share a pot** section has a second guided card (seven steps: wallet, test USDC, officer, propose, fund, approve, pay out). You act as the treasury: pick a pot, the page works out each holder's share from the contract's cap table, you pay it into escrow, approve its plan hash as the open board, and the contract pays every shareholder once. It uses the contract's existing payout functions, so it does not use up the sandbox and any number of visitors can run it; each run is its own payout, found again after a wallet redirect by its plan hash. It was run through the app's buttons with the test signer (every step and an independent recomputation of every amount checked); it has not been run with a real wallet.

**Open sandbox (try the whole flow yourself).** The page has a section **Run a round on testnet** (nav: "Run it") that walks through eight steps in order: connect a wallet, get test USDC, make yourself an officer, set the round (the modeler above), propose it, fund it, approve it as the board, and close it. Each step shows whether it is done, current or waiting, and the layout never moves while chain data refreshes. It runs on a second, separate Rounds contract on testnet with the founders and two SAFEs already closed and the Series A left for you; "Load the open sandbox" in the contract box shows the same contract's cap table and re-checks its hashes.

Its board is `contract/open-board`, a tiny contract that lets anyone ask it to act as the board for that one contract (it forwards only a short list of board methods). Sputnik DAO cannot give every visitor a vote: its "Everyone" role fails with `ERR_UNSUPPORTED_ROLE` when votes are counted, so the sandbox deliberately uses this open board instead; the demo run keeps its real 2-of-3 Sputnik DAO. The modeler is tied to the sandbox: its founders, pool and SAFEs are read from the chain and locked, so you choose only the round's terms and what you model is exactly what gets proposed. At the end you hold your Series A shares and the SAFEs have converted. A sandbox can run only one Series A (the SAFEs convert once), so there is a pool of sandboxes (`web/public/sandboxes.json`) and each visitor gets the first one that is still unused; if all are used the guided steps say so. `make sandbox` adds a fresh one to the pool. Testnet, no value, never use an open board for real money.

The Verify button reads the live contract named in `web/public/deployment.json`.

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
| Rounds contract | `rounds-core-332657.testnet` |
| Board (Sputnik DAO v2.0.0, 2-of-3 council) | `rounds-board-332657.sputnik-v2.testnet` |
| Test USDC (6 decimals, public faucet) | `rounds-usdc-332657.testnet` |

| Demo step | Key transaction |
|---|---|
| DAO board created (2-of-3 council) | [CBjoyTvg…](https://testnet.nearblocks.io/txns/CBjoyTvg46iq6HXQG8SNLuUzdotw3gHgDmakA2m5bLQx) |
| Founders and pool closed (after a board vote) | [BQjYKsyu…](https://testnet.nearblocks.io/txns/BQjYKsyuxxH8EZtvzuhsmyQcXGpCodE9pXYVDhs4dAcw) |
| SAFE 1 closed, SAFE 2 closed | [FUKR6FXt…](https://testnet.nearblocks.io/txns/FUKR6FXtigCSDs4kvdSQiyCogEmZm8F9hvv841fArN1g), [3zNMoHYZ…](https://testnet.nearblocks.io/txns/3zNMoHYZaJHxRfmFPBgnRzSZSmX14cABarq2JaCqaBti) |
| Fund pays $9,000,000 into escrow | [5amo4PEf…](https://testnet.nearblocks.io/txns/5amo4PEfw32RCBQ99Jpq7TJep7XNRZaAKyNNfjKsaKoe) |
| Series A closed, holdings credited | [DsQFjqyN…](https://testnet.nearblocks.io/txns/DsQFjqyNHd8HUT7EiYvvB98TnU5ajx99SuGJsQ7FfWpJ) |
| Attack: a stranger calls `approve_round` (**fails on chain**: only the board) | [BfbQ7u3W…](https://testnet.nearblocks.io/txns/BfbQ7u3WgpGjwPobgx53tkAGzRAo7XDmNJkEJ5uAizv9) |
| Wrong-token deposit (refunded in full) | [4y67Jwrn…](https://testnet.nearblocks.io/txns/4y67JwrnunqMYehb75rLjhQNjKYPJGi4mqWLZzmQAKnL) |
| Attack: `close_round` a second time (**fails on chain**: already closing/closed) | [A8nEWMuy…](https://testnet.nearblocks.io/txns/A8nEWMuywqUVAyMC6tyPubNAtLW1qGWSxr1BVyw3LyJc) |
| Attack: an officer proposes the approved Series A plan with a $1 raise (**fails on chain**: plan does not carry these terms) | [4AsbsTGM…](https://testnet.nearblocks.io/txns/4AsbsTGMkePnGn7aHF8YB74cKyASHxGBzkuK9MVTyw8f) |
| Board executes the option grant for Efe | [8r5epXYr…](https://testnet.nearblocks.io/txns/8r5epXYrskPfhanM4Y4bremzPYxb2e7Da5vRPtBNj4or) |
| Zed funds the $20M exit; board approves; distribute | [5aJjxcZN…](https://testnet.nearblocks.io/txns/5aJjxcZN9Asqxj5b2N6xgoir1MH4UNAHUm6SDYKLcQu), [3XQ3qfzU…](https://testnet.nearblocks.io/txns/3XQ3qfzUArqtQKRAYztxjuiWtYaRkAbrWe2gh3WQa297), [GXUKYGZK…](https://testnet.nearblocks.io/txns/GXUKYGZKVP1i8mgfCP9JQ1SXWMzKVJWgEj1mth6JbxsB) |
| Efe exercises 1,000 vested options out of the pool (strike $2,000 held by the contract) | [2Xez75oH…](https://testnet.nearblocks.io/txns/2Xez75oHUowbHh8disKksXC2QuU4yL7VrKyQeQ1PSXHw) |
| Board sweeps the held strike to the treasury | [5HeMtV4Z…](https://testnet.nearblocks.io/txns/5HeMtV4ZFXLU9NkuMM7FNAt9VCJ3QJyAKu7RJZ5LSECH) |
| Shared payout (step 10, `make distribute`): an officer proposes a $100,000 pro-rata plan; the DAO funds it from its own treasury; the board approves its hash; anyone runs distribute | [6e5HJpMc…](https://testnet.nearblocks.io/txns/6e5HJpMckW8iDKoLs17L4q8cYwXyGsrsRBQcdEGtnvQw), [2sTXcXLy…](https://testnet.nearblocks.io/txns/2sTXcXLyRhK7L7HPidUQDc91vH93BZ2Td6RyiTsDWqke), [33SzbUG3…](https://testnet.nearblocks.io/txns/33SzbUG3R6XZDNpHthwbFP5mtTHKyxugdxrcHD38QqNG), [8wYUkrEJ…](https://testnet.nearblocks.io/txns/8wYUkrEJJdBWUnMAYUVY6oar8Yqo9CnuCj6CrkFJ7JGq) |

All transactions of the final run are in `results/demo-txs.json`, and every event in `results/demo-events.json`.

Be aware of what this run does and does not show:

- **The failed attacks are on chain.** The demo signs each hostile call, broadcasts it over RPC itself, and requires the transaction to fail with the contract's own message; `make verify-onchain` re-reads all three failed transactions from the chain and checks that they failed. The wrong-token deposit is a separate, successful transaction whose refund the script verified by balance.
- **This run went start to finish in one go** (exit 0, no resume). The testnet faucet refused every request that day (HTTP 429), so the run was started with `DEMO_FUND_FROM=118174` and the new accounts were funded from the previous run's leftover testnet NEAR (see `scripts/demo.ts`). Earlier runs (suffixes `012465`, `372231`, `052090`, `118174`) also exist on testnet and are superseded; they run older contract builds.
- **The deployed contracts are the current source.** Suffix `332657` and the sandboxes in `web/public/sandboxes.json` run it: the plan hash covers the money terms as well as the shares, escrow goes to a separate treasury (here the DAO), closing a round reserves share capacity and SAFE ids against a concurrent close, a plan that can never be credited is refused before any money moves, options exercise out of the unissued pool, a cancel refunds within its gas and exits can be called off and refunded, and arithmetic is checked. The concurrency, overcommit, uncreditable-plan, many-investor cancel and exit-refund cases are covered by the sandbox tests, not triggered in the testnet run. Older testnet deployments run earlier builds whose hash covered the shares only; the app's Verify table says which kind it is reading.
- **Vesting.** The script reads the contract's `vested` view at a specific block whose timestamp is 12.15 demo "months" after the grant start (the block is pinned, so a slow script cannot read a later month) and requires exactly the engine's month-12 value: 25,000 of 100,000. One demo "month" lasts 5 seconds, a contract parameter.
- **RPC.** The old public endpoint `rpc.testnet.near.org` now rejects requests as deprecated, so the app, the demo and `make verify-onchain` use FastNear (`test.rpc.fastnear.com`; old transactions via `archival-rpc.testnet.fastnear.com`). Both can be overridden with `RPC_URL` and `ARCHIVAL_RPC_URL`.
- **Exercise on chain** is now in the run: after the exit, Efe exercises 1,000 of the 25,000 vested options at $2.00 (the demo checks the shares come out of the pool, the strike is held, then the board sweeps it to the treasury and `ledger_total` returns to 0). It runs after the exit so the GV-2 waterfall stays exactly as derived; `make verify-onchain` re-checks the resulting cap table.

`make demo` is the script that produced this run. It needs the `near` CLI (near-cli-rs), network access, and creates fresh throwaway testnet accounts through the public faucet (or a previous run's leftovers); it spends no real money. Each run creates fresh accounts; set `DEMO_SUFFIX=<suffix>` to resume a partly finished run, or `DEMO_FUND_FROM=<old suffix>` to fund the new accounts from a previous run's accounts when the faucet refuses.

## How NEAR is used

- **Sputnik DAO** (testnet factory `sputnik-v2.testnet`) is the board and the treasury. Approvals are ordinary FunctionCall proposals; the contract sees the DAO account as the caller. In step 10 the DAO also spends its own treasury through a FunctionCall proposal on the token (`ft_transfer_call` with the 1 yoctoNEAR a NEP-141 transfer needs). A 2-of-3 council needed two votes in the spike and the demo.
- **NEP-141** for payments: a self-deployed test USDC with a public faucet (no testnet USDC was used).
- **Named accounts** for every role, **NEP-297-style contract events**, and **plan hashes** (sha256 of RFC 8785 canonical JSON) that the board approves and the verifier recomputes.
- NEAR AI Cloud and NEAR Intents are **not** used. Cross-chain payment is described, not run, because NEAR Intents has no testnet.

## Simplifications and limits

- Not legal advice; no legal validity for any instrument.
- Simplified post-money SAFE: no MFN, no pro-rata side letters, no liquidity-event or dissolution mechanics beyond the exit waterfall. RULES.md now maps each SAFE rule to the clause in the YC post-money forms (Valuation Cap Only, Discount Only, MFN Only; downloaded 2026-11-07). Three things go beyond or differ from those forms: a SAFE with both a cap and a discount is Rounds' own extension, Promised Options are not modelled, and exits before a SAFE converts are not modelled. The mapping is not legal advice.
- Preferred is 1x non-participating only; no convertible notes, participating preferred, pro-rata rights or transfers.
- In public mode, holdings, deposits and payouts are public on chain. The optional confidential mode hides holdings only (see its section: deposits, payout amounts and the pot stay public).
- The contract credits the issuances in the approved plan; it does not recompute the equity math (rounds, exits, shared payouts), with one exception: SAFT conversion (R11), which it computes itself and refuses to credit if the plan differs. The safety argument is the board's approval of the plan hash plus anyone re-verifying with the engine.
- Payout receivers must already be registered with the token (NEP-145); otherwise their payout fails and stays retryable. `distribute` is capped per call by the contract constant `MAX_DISTRIBUTE` (an estimate, not a measured limit).
- The shared payout (RULES.md R10) is checked by a hand-derived vector (GV-8, computed with independent integer arithmetic), a property test, the on-chain run and `make verify-onchain`; it is **not** in the Python reference or its 1,000-scenario conformance. It is a plain per-holder floor division, but the independence caveat above applies to it in full. Who is eligible is the engine's choice (every holder, every class, not the unissued pool): a group that wants a different rule (by class, by vesting, by reputation) would change the plan the board approves, not the contract.
- Cancelling a round refunds up to eight depositors in the same transaction (fewer if little gas is attached, so the cancel itself never fails for gas); anyone can then call `retry_refund` for each remaining investor. The board can call off an exit with `cancel_exit` until its first payout is sent, and each funder then takes back exactly what they paid with `refund_exit`.
- A payout plan ("exit") does not retire or freeze holdings, and nothing stops the board from approving a second one over the same holdings. The contract pays the approved list; whether a payout is a final sale or a distribution along the way is the board's decision, visible on chain. Exercise strikes are held in `strike_balance` and the board forwards them to the treasury with `withdraw_strikes`; a failed transfer re-credits the balance.
- Option grants reserve their shares against the pool: `grant` refuses to promise more than the pool holds (`open_claims` and `pool_available` expose the totals), exercising moves shares out of the pool, and terminating a grant frees the unvested part while the vested part stays claimable until its 90-day window closes. Unexercised shares are never minted.
- The sandbox tests use a plain account as the board; the real DAO path was shown on testnet.
- Tested limits: legal validity, tax treatment, real-world SAFE edge cases and behaviour at scale are **not** tested.

## Tracks

**Entered in three tracks, selected in the submission form: Privacy, Social Money and Open Innovation.** The hackathon FAQ allows a project to select every track it fits ("one submission per project"); this is one project in three tracks. The same entrant has a second, independent project in a different track, Tremor ([github.com/samuel025/tremor](https://github.com/samuel025/tremor), Memecoins With Mechanics); each README names the other, as the FAQ requires (see the disclosures below).

- **Privacy.** An opt-in zero-knowledge confidential mode keeps each holding off the chain: the contract stores only a sealed fingerprint of the cap table, checks a Groth16 proof of it, and pays a holder's share without saying which row is theirs. Honest limits: deposits, payout amounts and pot totals are public, the trusted setup is a single-contributor development one, and the board approves a root it checks against a private table file rather than reading numbers on chain.
- **Social Money.** Collective ownership on top of Sputnik DAO: a group's pooled money, its shared ownership record, its contributor grants and its payouts all run through the group's own DAO, which approves each one by exact plan hash (the demo run uses an unmodified 2-of-3 Sputnik DAO v2, which is also the treasury that receives the pooled money). The DAO is used as it is; Rounds adds what the group does with it, including a shared payout: the DAO treasury funds a pot, the board approves its plan hash, and the contract pays every shareholder pro rata (demo step 10, the app's "Share a pot" card, which any visitor can run on a sandbox). Voters can check what they approve in the Board proposals card. See the table at the top, "Testnet addresses and transactions" and the `make verify-onchain` output for the proof. Not used: Trezu (looked up, not integrated; see above).
- **Open Innovation.** New ways for money and ownership to work together: an exact equity engine, a second implementation that agrees with it on seeded random scenarios, a contract that recomputes SAFT token conversions itself, a read-only verifier that anyone can run, and a live app where you run a whole round and a shared payout yourself on testnet.
- **Not entered:** the AI and agent tracks (NEAR AI Cloud and NEAR Intents are not used), and Real-World Money (everything here is a no-value test token; there are no payment rails, invoicing or payroll).

## Check before you vote

A Sputnik proposal shows a free-text description and a base64 call, so a board member votes on a hash they cannot read, and the description could say anything. The app's **Board proposals** card (Events & verify) reads any Sputnik DAO that is a Rounds contract's board and, for each proposal that calls the contract or spends the treasury into it, shows what the vote really does:

- It decodes the call and recomputes the plan hash in the browser, then compares it with the hash the contract holds. A proposal that carries the wrong hash, a plan that no longer hashes to its fingerprint, or a round whose money terms differ from its plan is marked **DOES NOT MATCH** and its Approve button is disabled. The proposer's own description is shown but never used for the verdict.
- It shows the change as numbers: who pays how much, shares issued and the price per share, which SAFEs convert, ownership before and after; the payouts of an exit per account; a grant's terms. It covers approving a round, approving an exit, a grant, and the treasury funding an exit; other board calls are described in words and marked as not machine-checked.
- A board member can vote from the same card, and can **put a round to the board**: the app writes the proposal's description from the plan itself and links back to the review, so voters in any DAO tool can read it.

Limits: the check says the hash in the vote is the plan the contract holds and shows what that plan does. It cannot tell a voter whether the plan is a good deal, and an exit's payouts are re-hashed from what the contract stores, not from the file the proposer wrote. The review logic is covered by unit tests (`test/review.test.ts`); the page was read against the committed testnet demo (all ten proposals of its DAO re-check as matching). Voting from the card goes through your wallet and was not exercised on testnet in this build.

## Tokens and SAFTs

Most crypto startups raise with SAFTs or token warrants, not only equity, so Rounds handles them too: the engine models them (RULES.md R11, `src/engine/saft.ts`), the contract enforces them, and a second testnet deployment ran them end to end (demo step 11, `make tokens`, re-checked read-only by `make verify-tokens`).

- **Selling a SAFT** is a `Saft` round, like a SAFE round: the investor pays exactly the SAFT amount into escrow (the plan hash covers it) and the DAO approves the plan by hash. The SAFT is stored with its terms: amount, FDV cap, discount.
- **At launch** the board names the project token once (`set_project_token`), the DAO funds a **token reserve** from its treasury (an ordinary `ft_transfer_call` proposal), and the board approves a conversion plan by hash (`convert_safts`). **The contract recomputes every token count itself** from the SAFT's stored terms (tokens = amount ÷ the lower of the cap price and the discounted launch price, exact integer arithmetic) and refuses the plan if any number differs, if the SAFTs would hold more than the total supply, or if the reserve cannot cover every claim. This is the one place where the chain computes the maths instead of trusting the plan; the sandbox tests include a mutation check (swapping the price rule makes them fail).
- **Each conversion becomes a vesting token grant** (nothing before the cliff, then linear, the same rule as option vesting). The board can also grant a contributor tokens from the same reserve (`grant_tokens`, programmable rewards), and end a grant (`terminate_token_grant`). Grants are claims on the reserve and can never promise more than it holds. Anyone may trigger `claim_tokens`; it pays the grantee what has vested, locks the claim before the transfer and restores it if the transfer fails.
- **In the app**, the Board proposals card decodes these votes too: a conversion plan is re-hashed and **every token count is recomputed in the browser** from the SAFT terms in the plan; a grant's terms are re-hashed; a reserve deposit is described in whole tokens.

The testnet run (`rounds-tok-332657.testnet`, with the demo's DAO as board and treasury and its test USDC as the payment token, plus the project token `rounds-tkn-332657.testnet`): $500,000 and $250,000 of SAFTs sold, 100,000,000 tokens put in the reserve by the DAO, conversion at a $0.015 launch price (SAFT 1 at its cap price, 25,000,000 tokens; SAFT 2, with a 20% discount, at the discount price, 20,833,333.333333 tokens), a 1,000,000-token contributor grant, the unlock read at a pinned block in month 4 (16,666,666,666,666 units, equal to the engine), and every claim paid. It recorded <!--n:tokens.transactions-->36<!--/n--> transactions and <!--n:tokens.events-->12<!--/n--> contract events, and `make verify-tokens` passes <!--n:verify_tokens.checks-->18<!--/n--> checks with <!--n:verify_tokens.failed-->0<!--/n--> failed. An officer's attempt to sell a $500,000 SAFT for $1 [fails on chain](https://testnet.nearblocks.io/txns/BDDfVwDf4PaHRSrzYfzS4e5MnERgjqmRak1fHYZrmrbJ).

| Step | Key transaction |
|---|---|
| Second Rounds contract deployed (DAO as board and treasury) | [13khZ9Bm…](https://testnet.nearblocks.io/txns/13khZ9BmFYnVdSTeU7eWcn3JLpj7g4oVD6e7fmbxfvvG) |
| Saft round closed | [A4CEtCtQ…](https://testnet.nearblocks.io/txns/A4CEtCtQr2LexHgRtXWQzgHWpcg5ndCbGR1fvPo7wh8p) |
| DAO funds the token reserve | [CFmRVB6X…](https://testnet.nearblocks.io/txns/CFmRVB6XiU1ut21wS6LnjRN83TW5DuwigrS4hMZ3j6Mi) |
| DAO approves the conversion plan; the contract recomputes and creates the grants | [GjFkKvfh…](https://testnet.nearblocks.io/txns/GjFkKvfhK5Kra1GFzsjqxtd9AUgj8USiVHaCar4Sp1at) |
| DAO grants a contributor tokens | [9uGcUToQ…](https://testnet.nearblocks.io/txns/9uGcUToQGRTGSEPuamMMoWfimQmhn5HerED3pcnma4Go) |
| Claims: chidi, dayo, efe | [G37EX8kK…](https://testnet.nearblocks.io/txns/G37EX8kKMzhzL8KZFpFLKLoHdinQ1iV7ArrnNagnT1NZ), [HXsc2eRB…](https://testnet.nearblocks.io/txns/HXsc2eRBzf5WyJ8yvfYT9gLFfugjw2DbiBtmMRUTo28f), [24BW7h5d…](https://testnet.nearblocks.io/txns/24BW7h5dHkUQbmZvn4Wf3yjUzn4zQ4f5BtPPtFeGdz1t) |

Limits: the first demo contract (`rounds-core-332657`) and the open sandboxes were deployed before this code and do not have token methods; only the second contract does, and the app's Verify and Board proposals views read it by pasting its account into the contract box. Token amounts are in the token's base units, and the exact conversion needs `amount × supply` to fit in 128 bits (fine for six-decimal tokens; an 18-decimal token with a very large supply would be refused, never mis-converted). The Python reference does not cover R11, so its independence caveat applies; the anchors are the hand-derived vectors GV-9a to GV-9d, the contract's own recomputation and the on-chain run. Whether a SAFT is a security is a legal question Rounds does not answer. There is no token price oracle: the launch price and supply are inputs the board approves, and a voter checks them in the review card.

## Questions a reviewer will ask

- *Why a blockchain at all?* Only for approvals and payouts that anyone can verify against a plan hash; the equity math itself stays off chain.
- *Why not Carta?* Carta works, is legally grounded and integrates with lawyers and banks. Rounds adds what a spreadsheet or a cap-table service cannot: a board approval bound to exact numbers, and a record anyone can re-check, with holdings kept private if the group chooses. The legal wrapper stays the organization's job.
- *What is the scope today?* Testnet play money with no legal status; simplified SAFE terms; an engine whose correctness rests on tests and a second implementation rather than formal proofs; and, in the confidential mode, holdings are hidden while deposits and payout amounts stay public, on a development trusted setup (details in that section).
- *Why build it anyway?* The failure it targets is real: nobody can check a cap table. A reproducible engine, a board vote on a hash and a read-only verifier are a small, honest step toward fixing that.

## Next steps for privacy (roadmap)

In confidential mode only holdings are hidden; deposits and payouts are public on chain, so this is not a fully confidential product. What would change that, in order of what it would hide:

1. **Hash commitments for holdings and round plans.** The chain would store a salted fingerprint per holding instead of holder names and share counts, and each holder would keep a receipt that proves their holding. This hides who holds how many shares, but deposits and exit payouts are ordinary token transfers, so an investor's payment and an exit payout would still be visible; the plan would also no longer be re-checkable by someone without the plan file.
2. **Zero-knowledge proofs** (for example that a round's class totals add up) in place of reading a plan, which would remove most of the leaks of a commitment tree. This needs circuits, a proving setup and an on-chain verifier.
3. **Shielded payments** so that deposits and payouts are private too. NEAR has announced Confidential Intents for private transfers; the details here come from news reports not checked against NEAR's own documentation, and NEAR Intents has no testnet, so none of it is used in this project.

Until then, holder IDs can be pseudonymous NEAR accounts, with the link to real identities kept off chain.

## Hackathon disclosures

- **Code window:** all code in this repository was written starting 2026-11-06.
- **AI assistance:** AI coding tools (Claude Code) were used to write code, tests and documentation, as the hackathon rules ask to be listed; the team directs, reviews and submits the work.
- **Dependency audit:** `npm audit --omit=dev` reports known issues (`elliptic`, `decode-uri-component` and others) inside the NEAR wallet libraries' dependency trees. The app never handles keys (every transaction is approved in the visitor's wallet) and is testnet-only; the engine, contract and scripts do not use those packages.
- **Libraries:** near-sdk 5.30, near-workspaces 0.22, cargo-near 0.22, near-cli-rs 0.30, Sputnik DAO v2 (deployed from the testnet factory), TypeScript, Vitest, fast-check, Vite, Python standard library (fractions).
- **Other NEAR project by the same entrant:** [Tremor](https://github.com/samuel025/tremor), a NEAR testnet memecoin whose supply grows, only to a fixed relief list, when a major earthquake confirmed by the USGS record is attested by independent bots; it is entered in **Memecoins With Mechanics**. The two are independent: a different idea, different code and a different track. Tremor's README names Rounds in return.
- **Inspiration:** the web app's look was modelled on resend.com's design tokens; no Resend code or assets are used.

## License

MIT, see [LICENSE](LICENSE).
