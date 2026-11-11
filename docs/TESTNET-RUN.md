# The committed testnet run: addresses, transactions and caveats

What `make demo` produced, with every key transaction. `make replay` and `make verify-onchain` check this run.

[← back to the README](../README.md)

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
