// The narration of the demo video, one continuous paragraph per scene (shared by record-demo.mjs and tts-warm.mjs).
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const VOICE = process.env.VOICE ?? "en-US-AndrewMultilingualNeural";
export const ttsFile = (text) => join(process.env.REC_DIR ?? tmpdir(), "tts-cache", createHash("sha1").update(VOICE + text).digest("hex") + ".mp3");

export const N = {
  introA: "Rounds keeps a company's cap table private, yet a DAO can still approve it to the exact number. Zero-knowledge proofs seal each holding, and every plan is checked against its fingerprint on NEAR.",
  introB: "Built on NEAR testnet. Let me show you how it works.",
  zkIntro: "In confidential mode, the blockchain stores only a sealed fingerprint of the cap table, plus a proof that the hidden numbers add up. Who holds what never appears on chain.",
  zkSetup: "First, free test dollars, and officer status so I can propose a round. A test key signs here, so there are no wallet pop-ups.",
  zkPropose: "Now the key step. The page builds the private table in your browser, proves it adds up, and sends only the fingerprint and the proof. Holders make their own keys, on their own devices.",
  zkFiles: "Each holder gets a claim file. The board gets the private table, and an encrypted copy committed in the round.",
  zkBoard: "Before approving, the board checks its copy against the chain. The right one matches exactly.",
  zkBoard2: "Change a single number, and it is refused.",
  zkFund: "Now the round is funded, approved by its fingerprint, and closed. Nobody ever saw who holds what.",
  zkPayout: "Next, a private payout: the treasury funds a pot, and the board approves it.",
  zkClaim: "A holder claims with their own key. The proof shows they are in the table and owed this amount, without saying which row. A relayer submits it, to a brand-new account, so no holder wallet appears.",
  zkDone: "The account holds exactly its share, and the same proof cannot be used twice.",
  publicIntro: "Rounds also has a transparent mode with the full toolkit: priced rounds, notes that convert, vesting, payouts and tokens.",
  modeler: "You set the valuation, new money and option pool, and the page works out every price and everyone's ownership, down to the exact share.",
  flow: "Then you run that round on testnet: get test dollars, become an officer, and propose the round with its fingerprint.",
  approve: "Fund it, the board approves that exact fingerprint, and the contract issues the shares.",
  result: "You hold your new shares, and the early investors' notes became shares too.",
  share: "Treasuries can pay holders pro rata. Drag the pot, and every payout updates exactly, with any leftover under a cent shown.",
  shareRun: "Run it for real on the same company: propose, fund, approve, and the contract pays each holder once.",
  sharePaid: "Every row says paid.",
  verify: "You do not have to trust the page: it recomputes each plan's fingerprint in your browser and compares it with the chain.",
  review: "Voting is clearer too. Here is a real board proposal, decoded and checked against the chain. It says who pays what, and how many shares each person ends up holding, so a voter knows exactly what they are approving.",
  review2: "A payout proposal is checked the same way. The amounts a voter sees are the amounts the contract will pay.",
  tokens: "Token sales work the same way. On a second contract, the DAO approved a conversion plan, and the contract computed every investor's tokens itself.",
  close2: "That is Rounds: a private cap table, a DAO vote that means something exact, and checks anyone can run. Built on NEAR testnet with play money, and not legal advice. Thanks for watching.",
};
