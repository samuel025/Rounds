// The narration of the demo video, one continuous paragraph per scene (shared by record-demo.mjs and tts-warm.mjs).
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const VOICE = process.env.VOICE ?? "en-US-AndrewMultilingualNeural";
export const ttsFile = (text) => join(process.env.REC_DIR ?? tmpdir(), "tts-cache", createHash("sha1").update(VOICE + text).digest("hex") + ".mp3");

export const N = {
  hook: "Groups that pool money and make decisions together, like a startup, an investment club or a collective, usually keep track of who owns what in a spreadsheet. And when the group votes yes, nobody can prove exactly what it voted yes to. Rounds is a prototype that fixes that, built on a NEAR DAO. Every funding round becomes one exact plan. The DAO approves that plan, and anyone can check it afterwards. Here is what a funding round does to ownership: before, and after.",
  basics: "If cap tables are new to you, there is a plain-English box and a glossary. A cap table is just the list of who owns how much. The company here is made up, and this is the list after a funding round.",
  modeler: "Here you set up the round: what the company is worth, how much new money comes in, and how big the employee option pool is. The page works out the price of a share and everyone's new ownership, down to the exact share, and it shows any rounding leftovers. The company on this page is a real one on a test network, so what you set here is exactly what gets sent.",
  flow: "Now the part that matters: running that round for real, in eight steps, on a test network with play money. In your browser, your own wallet approves each step. In this recording a test key signs for me, so there are no wallet pop-ups.",
  usdc: "Step two: get some free test dollars from the contract's tap.",
  officer: "Step three: become an officer. Officers are allowed to propose rounds. In a real group the board chooses them; this practice board lets anyone.",
  propose: "Steps four and five: the round you set up is sent to the blockchain as a proposal, together with its fingerprint. The fingerprint is a short code that changes if even one number changes.",
  fund: "Step six: pay in. The money is held by the contract until the round closes.",
  approve: "Step seven: the board approves the plan by its fingerprint. Here you play the board. In the real demo, this is a two-of-three DAO vote. Change one number, and the fingerprint no longer matches, so the contract refuses.",
  close: "Step eight: close the round. Anyone can do this once it is paid for and approved. The contract now issues the shares.",
  result: "And that is it. You hold your new shares, and the early investors' notes have turned into shares too, all recorded on the blockchain.",
  share: "Groups also need to pay people. Here, a treasury shares a pot of money with everyone who holds shares, in proportion to how many they hold. Drag the pot, and every payout updates exactly, with any leftover under a cent shown.",
  shareRun: "And you can run one for real, on the same test company. You are the treasury. First I become an officer, then I propose the payout. The page worked out each holder's share from the real cap table.",
  shareFund: "Now the treasury puts the money in. Nobody is paid yet.",
  shareApprove: "The board approves that exact plan.",
  sharePay: "Now anyone can trigger the payout. The contract pays each holder, once.",
  sharePaid: "And now every row says paid.",
  verify: "You do not have to trust this page. It reads everything straight from the blockchain, works out each round's fingerprint again right here in your browser, and compares. A pass means they match exactly.",
  review: "Now, voting. A normal DAO vote shows a short note and a block of code, so members cannot easily tell what they are approving. This card reads each proposal, decodes it, and checks it against the blockchain. It shows who pays what, what changes, and everyone's ownership afterwards. If the fingerprint does not match, the Approve button is switched off. This is the Series A approval from the real demo, and this is the payout the DAO approved from its own treasury.",
  tokens: "Crypto startups also sell tokens before launch, in agreements called SAFTs. On a second contract, that ran start to finish. At launch the DAO approved a conversion plan, and the contract worked out every investor's tokens itself, and would refuse anything that did not match. This card does the same sum in your browser, and the numbers agree. The tokens are then released gradually, and holders claim them as they unlock.",
  close2: "Rounds is a testnet prototype. Holdings are public, it is not legal advice, and it has not been audited. The code, the tests, and a way to check every claim are in the repository. Thanks for watching.",
};
