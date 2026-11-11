# Using the app: wallet, sandboxes and deploying

Everything about the web app beyond the README's quick start.

[← back to the README](../README.md)

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


## Using it today

Rounds is built on NEAR **testnet**: fake money only. The app connects a NEAR **testnet** wallet (wallet-selector: MyNearWallet, Meteor) to sign real testnet transactions. The app is a static site (`vercel.json` builds it on Vercel from this repo) and reads the testnet contract directly from the chain. Three levels of use:

1. **Look and verify.** Open the [live app](https://roundcap.vercel.app), click **Verify**, or paste any Rounds contract account into the box under Events & verify. To run it yourself (about five minutes, no accounts): `git clone`, `npm install`, `make web-dev`, open the local address. Click **Verify** to check the live testnet contract. `make replay` (offline) and `make verify-onchain` (read-only) check the committed demo run.
2. **Run your own test round.** Install the `near` CLI (near-cli-rs) and run `make demo`. It creates throwaway testnet accounts, a 2-of-3 board DAO, a test token and the Rounds contract, then runs the rounds, four attacks and an exit.
3. **Use it for a real company: not possible yet.** It would need a mainnet deployment (deliberately not done), and legal documents. A SAFE and a share issuance are legal acts that Rounds does not replace.


## Deploying the app (Vercel)

The app is a static site. `vercel.json` already sets the install command, the build command (`node scripts/rules-html.mjs && npx vite build`), the output folder (`dist`) and security headers, and `.vercelignore` keeps the upload small. Import the GitHub repository in Vercel and press Deploy (no environment variables are needed), or run `vercel --prod` from the repository root. A clean clone with only the files the build needs was built to check this. It reads the testnet chain directly from the visitor's browser.


## Why this matters

*New to cap tables? The page opens with a plain-English box and a glossary (cap table, SAFE, Series A, option pool, plan hash and the rest).*

Take a crypto startup that raises from several investors. Ownership lives in a private spreadsheet and goes wrong in familiar ways: different people compute different numbers, an investor cannot check that what they were promised is what was recorded, and when the board votes "yes" to a round, nobody can prove afterwards exactly which numbers it approved. Teams that already govern on-chain may find a verifiable record a natural fit, but that demand is unvalidated here, and similar on-chain cap-table products already exist. Rounds is not a replacement for a conventional cap-table service for a private company: holdings here are public, it models equity only, and it is a testnet demo.

Rounds makes the math checkable:

1. **One set of exact rules.** [RULES.md](RULES.md) defines every number (share price, SAFE conversion, option pool, exit payouts). The engine follows it with exact integer arithmetic and reports every rounding remainder.
2. **An approval that cannot be swapped.** A round is written as a plan with a SHA-256 fingerprint. The plan holds the shares to issue and the money terms (the kind of round, who pays how much, the funding deadline), and the contract refuses a proposal whose terms differ from the ones inside the hashed plan. The group's board (a DAO vote on NEAR) approves that fingerprint, and the contract refuses to run any plan that does not match it. Investor money sits in escrow until the board approves.
3. **Anyone can re-check.** An investor, employee or board member can recompute the plan in their own browser and compare it with the chain (the app's Verify button).

Who it is for: a **founder or contributor** modelling and running a round; an **investor** verifying the shares they paid for; a **team member** checking vesting and exit value; a **board member** approving one exact plan.
