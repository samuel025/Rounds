# Wallet-derived keys, sealed data, sign-offs and the relayer fee

What changed in the app after the first confidential-mode release, why, and what it does not do.

[← back to the README](../README.md)

## The problem

A confidential-mode holder had to keep a secret key file and a claim file safe, or lose the payout. A board had to be sent a private table file and a passphrase by hand. A claim to a fresh address needed a relayer someone ran and funded. These are the ways the first version could lose people money or quietly fail.

## 1. A key from the wallet, not from a file

- The holder's ZK secret and an encryption key are **derived from one signature** (NEP-413 `signMessage`) of the fixed message `Rounds Cap Table Key v1` (recipient `rounds-cap-table`, fixed nonce). ed25519 signatures are deterministic, so the same wallet gives the same keys in any browser. Source: `src/engine/walletkey.ts`; wallet glue: `web/src/walletkeys.ts`.
- One secret **per share class** (HKDF with the class as input): a nullifier is `Poseidon(secret, exit)`, so one secret across two classes would allow only one claim.
- The first time, the page asks the wallet to sign **twice** and refuses a wallet whose two signatures differ: a key that cannot be derived again is worse than a file.
- **Sealed claim data on chain.** When the proposer builds a round, each holder's claim files are encrypted to that holder's own encryption key (`src/engine/sealed.ts`, X25519 + HKDF + AES-GCM) and posted with `publish_claim_blobs`, in the same transaction as the proposal. The blob is addressed by `sha256(public key)`, **never by an account name**, so the chain does not list who the holders are. A holder presses **Recover my claim with my wallet**: the page derives the key, finds the blob, decrypts it and re-derives the holder key, with nothing downloaded or uploaded.
- Claim files hold no secret (RULES.md R12), so what the blob protects is privacy of the holder's position, not funds.

## 2. The board opens the table with its wallet

- The proposer seals the private table once, for the board's named members: one AES-GCM body and a wrapped copy of its key per member (`sealForMany`). Each member first publishes their encryption public key with `register_enc_key` (the page's **Register my encryption key** button). The envelope's hash goes into the round's plan as `escrow_hash`, so the board's approval covers it, and the envelope is stored on chain once (`publish_board_envelope`).
- In the voting card, a member presses **Decrypt & verify with my wallet**. The page opens the table, re-seals it and compares it with the round's root. The result shows beside the Approve button: **Table matches on-chain root** (green) or a refusal to approve.
- The passphrase copy still works if you do not want a wallet.
- **What the badge proves.** That the table you opened is the one the root came from. It does not prove every row is a real person; that stays the board's judgement.

## 3. Relayer fee out of the payout

- The board sets a fee with `set_claim_fee`. A claim submitted by someone other than the recipient pays that fee to the submitter **out of the holder's payout**; a holder who submits their own claim pays nothing. The proof fixes the payout, so nobody can take more than the fee. A fee as large as the payout is refused (`ERR_FEE_EXCEEDS_PAYOUT`).
- The holder is paid first and the fee second, so a failure never pays a relayer and leaves a holder unpaid. A fee that cannot be delivered is kept for the relayer (`withdraw_fee`), and the ledger still balances.
- **What this does and does not remove.** Anyone can now run a relayer and be paid, with no operator needed, but **someone still has to run one**: it needs a funded NEAR account and a way to reach the page. The repository's relayer (`make relayer`) remains the default.
- **Fresh payout account.** The claim panel can generate a new account in the browser (`src/engine/stealth.ts`): a 12-word phrase on the standard NEAR derivation path, so it imports into any NEAR wallet. The contract registers it with the token, and the relayer pays the gas. Paying onward to an account linked to you links the two again.

## 4. Sign-offs, drafts and role views

- **Draft links** (`src/engine/draft.ts`, `web/src/drafts.ts`): the modeler's terms in the `#` part of the URL, which is never sent to a server. A link is treated as untrusted input: strict schema, size limits before and after inflating, names escaped. It is asynchronous: each change makes a new link. It never carries holder codes, claim files or a confidential table.
- **Investor sign-off** (`src/engine/signoff.ts`, `web/src/signoff.ts`): each investor with a NEAR account signs a message naming the **plan hash and their own row**; the proposer collects the signed texts, can commit the bundle on chain (`commit_signoffs`, while the round is still awaiting approval), and the voting card shows **N of M confirmed** with the missing names. A change to any money term changes the hash and the signatures stop matching. It confirms an allocation; it is not legal consent. Contract and multisig accounts cannot sign. **Public rounds only:** a confidential round hides its rows.
- **Role views** (`web/src/roles.ts`): Founder / proposer, Board voter, Investor / employee, or Everything. The Confidential card is split the same way: the founder and the board voter see the steps to build, check and approve a round (the Board check sits with the board), and the investor sees only the claim panel. A role only decides what is shown; every transaction is available whatever the view. Hashes and raw calls sit behind a "Technical proof" toggle in the investor view.
- **Before/after bars** in the Board proposals card: the ownership of every holder before and after, on one scale, with the change in points.

## Limits

- **Phishing.** Anyone who can get the wallet to sign the exact key message gets the keys. The recipient is the app's own name, which the wallet shows, but it cannot enforce it. Contract accounts and some hardware wallets cannot sign messages: the manual key file remains.
- **Wallets.** Tested against the app's DEV test signer (an ed25519 key signing like a NEP-413 wallet) on testnet. **Not yet run against MyNearWallet or Meteor**, whose `signMessage` the code calls as the wallet-selector documents.
- **The signature is the master secret** of the holder's key. It is held in memory only and dropped when the account changes.
- **A rotated wallet key** gives a different derived key: keep the wallet's recovery phrase.
- Sealed data is only as private as the key it is sealed to. A holder whose key was not derived from the wallet (the demo creates the other holders' keys in the page) has no sealed blob.
- The proving keys are still from a one-person development setup (see CONFIDENTIAL.md).

## Evidence

- `npx vitest run`: the derivations, NEP-413 framing, envelopes, sealed blobs, sign-offs, drafts (including a decompression bomb and hostile names), the stealth account (checked against `near-seed-phrase`, the library wallets use) and the dilution numbers.
- `make test-contract`: the relayer fee (paid, none on a self-claim, too large refused, unregistered relayer registered, failed payout restored, ledger back to zero), sealed blobs (once, by an officer, by hash, storage paid), the sign-off commitment and the board envelope.
- `make e2e-keys` (testnet, needs `make web-dev` running): see `results/e2e-keys.txt`.
