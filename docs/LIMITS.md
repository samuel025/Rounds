# Simplifications, limits and the privacy roadmap

What Rounds does not model, and what would make it more private.

[← back to the README](../README.md)

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


## Board and Trezu

The board is an unmodified Sputnik DAO v2 created from the testnet factory: every approval is an ordinary `FunctionCall` proposal on an account the contract treats as its board, so in principle any Sputnik DAO can be the board without changes. **Trezu was looked up, not used.** From its repository and third-party write-ups, Trezu (NEAR DevHub) is a treasury manager whose treasuries are Sputnik DAOs created by the mainnet factory; it covers payments, bulk payments, vesting and cross-chain transfers. I could not confirm that it supports testnet, opening a DAO it did not create, or custom contract calls such as `approve_round`, and its treasuries are reported to run a newer Sputnik contract than the v2.0.0 used here. So Rounds has not been run through Trezu's UI, and the demo does not claim to: the proposals and votes are sent with the `near` CLI, and the app's Board proposals card reads any Sputnik DAO directly.


## Next steps for privacy (roadmap)

In confidential mode only holdings are hidden; deposits and payouts are public on chain, so this is not a fully confidential product. What would change that, in order of what it would hide:

1. **Hash commitments for holdings and round plans.** The chain would store a salted fingerprint per holding instead of holder names and share counts, and each holder would keep a receipt that proves their holding. This hides who holds how many shares, but deposits and exit payouts are ordinary token transfers, so an investor's payment and an exit payout would still be visible; the plan would also no longer be re-checkable by someone without the plan file.
2. **Zero-knowledge proofs** (for example that a round's class totals add up) in place of reading a plan, which would remove most of the leaks of a commitment tree. This needs circuits, a proving setup and an on-chain verifier.
3. **Shielded payments** so that deposits and payouts are private too. NEAR has announced Confidential Intents for private transfers; the details here come from news reports not checked against NEAR's own documentation, and NEAR Intents has no testnet, so none of it is used in this project.

Until then, holder IDs can be pseudonymous NEAR accounts, with the link to real identities kept off chain.
