# Check before you vote: the Board proposals card

How a voter sees what a Sputnik proposal really does.

[← back to the README](../README.md)

A Sputnik proposal shows a free-text description and a base64 call, so a board member votes on a hash they cannot read, and the description could say anything. The app's **Board proposals** card (Events & verify) reads any Sputnik DAO that is a Rounds contract's board and, for each proposal that calls the contract or spends the treasury into it, shows what the vote really does:

- It decodes the call and recomputes the plan hash in the browser, then compares it with the hash the contract holds. A proposal that carries the wrong hash, a plan that no longer hashes to its fingerprint, or a round whose money terms differ from its plan is marked **DOES NOT MATCH** and its Approve button is disabled. The proposer's own description is shown but never used for the verdict.
- It shows the change as numbers: who pays how much, shares issued and the price per share, which SAFEs convert, ownership before and after; the payouts of an exit per account; a grant's terms. It covers approving a round, approving an exit, a grant, and the treasury funding an exit; other board calls are described in words and marked as not machine-checked.
- A board member can vote from the same card, and can **put a round to the board**: the app writes the proposal's description from the plan itself and links back to the review, so voters in any DAO tool can read it.

Limits: the check says the hash in the vote is the plan the contract holds and shows what that plan does. It cannot tell a voter whether the plan is a good deal, and an exit's payouts are re-hashed from what the contract stores, not from the file the proposer wrote. The review logic is covered by unit tests (`test/review.test.ts`); the page was read against the committed testnet demo (all ten proposals of its DAO re-check as matching). Voting from the card goes through your wallet and was not exercised on testnet in this build.
