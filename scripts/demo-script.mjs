// The narration of the demo video, one continuous paragraph per scene (shared by record-demo.mjs and tts-warm.mjs).
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const VOICE = process.env.VOICE ?? "en-US-AndrewMultilingualNeural";
export const ttsFile = (text) => join(process.env.REC_DIR ?? tmpdir(), "tts-cache", createHash("sha1").update(VOICE + text).digest("hex") + ".mp3");

export const N = {
  hook: "Crypto-native startups often raise money with SAFEs and make decisions on-chain, but the ownership table is still a spreadsheet, and a board's yes cannot be tied to the exact numbers it approved. This is Rounds, a testnet prototype of how that could work. Every funding round becomes an exact plan with a fingerprint, the board approves that fingerprint, and anyone can re-check the result on the NEAR blockchain. Here is what a Series A does to ownership: the bars show who owns what, before and after the round.",
  basics: "If you are new to this, the box at the top explains the basics in plain English, and there is a glossary. The company here is a made-up example. A cap table is simply the list of who owns how much, and this is what it looks like after a Series A funding round.",
  modeler: "In the round modeler, you choose the round: the valuation, the new money, and the option pool. The engine instantly works out the price per share and everyone's ownership, exactly, in whole shares, and it reports every rounding remainder. Notice that the company today, the founders, the pool and the early investors, is read from the blockchain and locked. This is a real sandbox company on testnet, so what you model here is exactly what gets proposed.",
  flow: "Now the part that matters. Here is the whole round as eight steps, on an open sandbox. In your browser, your own wallet asks you to approve each step. In this recording, a throwaway test key signs automatically instead, so you do not have to watch wallet pop-ups. Step one, the wallet, is already connected.",
  usdc: "Step two: test USDC, a free token with no value, from the contract's public faucet. One click, and the balance updates.",
  officer: "Step three: make yourself an officer. Only officers can propose a round. In a real organization, the board decides who the officers are. This open sandbox lets anyone become one.",
  propose: "Step four is the round you set above. Step five: propose it. This sends the plan and its fingerprint to the contract, with you as the investor, and it shows up on the blockchain as a new round, waiting for funding.",
  fund: "Step six: fund it. Your money goes into the contract's escrow, and the contract holds it until the round closes.",
  approve: "Step seven: the board approves the plan, by its exact fingerprint. On this sandbox, you act as the board. On the real demo, this is a two-of-three DAO vote. If even one number in the plan had changed, the fingerprint would not match, and the contract would refuse.",
  close: "Step eight: close the round. Anyone can do this once it is funded and approved. The contract now issues the shares.",
  result: "And there it is. You hold your Series A shares, and the early investors' notes have converted into shares of their own, all recorded on the blockchain.",
  verify: "You do not have to trust this page. Load a contract, and the page reads everything straight from the blockchain. It hashes each round's plan again, right here in your browser, and compares it with the hash the chain holds. A pass means they are identical. And any round can be shared as a single link.",
  exit: "We also ran a full scenario on a real two-of-three Sputnik DAO board, including an exit, where payouts are made automatically. The exit simulator shows how a sale price is split between common and preferred shares: at a low price the investor is paid first, and at a high price everyone converts.",
  close2: "Rounds is a testnet prototype. It models equity only, holdings are public on the blockchain, and it is not legal advice. The code, the tests, and a way to verify every claim are in the repository. Thanks for watching.",
};
