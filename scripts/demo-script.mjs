// The narration of the demo video, one continuous paragraph per scene (shared by record-demo.mjs and tts-warm.mjs).
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const VOICE = process.env.VOICE ?? "en-US-AndrewMultilingualNeural";
export const ttsFile = (text) => join(process.env.REC_DIR ?? tmpdir(), "tts-cache", createHash("sha1").update(VOICE + text).digest("hex") + ".mp3");

export const N = {
  hook: "Groups that pool money and decide with a DAO, like a crypto startup, an investment club or a contributor collective, still keep who owns what in a spreadsheet, and the group's yes cannot be tied to the exact numbers it approved. This is Rounds, a testnet prototype built on Sputnik DAO. Every funding round becomes an exact plan with a fingerprint, the DAO approves that fingerprint, and any member can re-check the result on the NEAR blockchain. Here is what a Series A does to ownership: the bars show who owns what, before and after the round.",
  basics: "If you are new to this, the box at the top explains the basics in plain English, and there is a glossary. The company here is a made-up example. A cap table is simply the list of who owns how much, and this is what it looks like after a Series A funding round.",
  modeler: "In the round modeler, you choose the round: the valuation, the new money, and the option pool. The engine instantly works out the price per share and everyone's ownership, exactly, in whole shares, and it reports every rounding remainder. Notice that the company today, the founders, the pool and the early investors, is read from the blockchain and locked. This is a real sandbox company on testnet, so what you model here is exactly what gets proposed.",
  flow: "Now the part that matters. Here is the whole round as eight steps, on an open sandbox. In your browser, your own wallet asks you to approve each step. In this recording, a throwaway test key signs automatically instead, so you do not have to watch wallet pop-ups. Step one, the wallet, is already connected.",
  usdc: "Step two: test USDC, a free token with no value, from the contract's public faucet. One click, and the balance updates.",
  officer: "Step three: make yourself an officer. Only officers can propose a round. In a real organization, the board decides who the officers are. This open sandbox lets anyone become one.",
  propose: "Step four is the round you set above. Step five: propose it. This sends the plan and its fingerprint to the contract, with you as the investor, and it shows up on the blockchain as a new round, waiting for funding.",
  fund: "Step six: fund it. Your money goes into the contract's escrow, and the contract holds it until the round closes.",
  approve: "Step seven: the board approves the plan, by its exact fingerprint. On this sandbox, you act as the board. On the real demo, this is a two-of-three DAO vote. The fingerprint covers the shares and the money paid for them, so if even one number had changed, it would not match, and the contract would refuse.",
  close: "Step eight: close the round. Anyone can do this once it is funded and approved. The contract now issues the shares.",
  result: "And there it is. You hold your Series A shares, and the early investors' notes have converted into shares of their own, all recorded on the blockchain.",
  verify: "You do not have to trust this page. Load a contract, and the page reads everything straight from the blockchain. It hashes each round's plan again, right here in your browser, and compares it with the hash the chain holds. A pass means they are identical. And any round can be shared as a single link.",
  exit: "We also ran a full scenario on a real two-of-three Sputnik DAO, which is the board and the treasury: pooled money, contributor grants that vest, four attacks that fail on chain, and a payout to every holder. The exit simulator shows how a sale price is split between common and preferred shares: at a low price the investor is paid first, and at a high price everyone converts.",
  share: "And here is what a community does with a shared treasury. The treasury shares a pot with everyone who holds shares, pro rata, whatever their class. Drag the pot, and each holder's payout updates, exactly, with the rounding remainder reported. On testnet this ran for real: the two-of-three DAO funded the payout from its own treasury, approved its fingerprint, and the contract paid six holders, each exactly once.",
  close2: "Rounds is a testnet prototype. It models equity only on chain, holdings are public on the blockchain, and it is not legal advice. The code, the tests, and a way to verify every claim are in the repository. Thanks for watching.",
};
