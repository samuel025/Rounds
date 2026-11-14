// Plain-language hints. Every ⓘ in the app is a <button data-hint="key">; one shared popover shows the text on hover, focus or tap, and Escape or a click elsewhere closes it.
// The wording assumes the reader has never seen a cap table. Keep each hint to a sentence or two: say what the thing IS, then why it matters here.
import { esc } from "./chain";

export const HINTS: Record<string, string> = {
  // the basics
  capTable: "A cap table is the list of who owns how many shares of a company. Here it is worked out exactly by the engine, and in confidential mode it is kept off the chain.",
  shareClass: "A class of shares. Common is what founders hold. Preferred is what investors usually get: it is paid back first if the company is sold.",
  testnet: "A practice version of the blockchain. Everything here is play money with no real value.",
  sandbox: "A practice company on the testnet, open to everyone, so you can run the whole flow yourself with fake money.",
  wallet: "A NEAR testnet wallet signs your actions. Nothing is signed in the background: every action opens your wallet for your approval.",
  roles: "Pick the view that fits you. It only changes what is shown; every action stays available, and “Everything” shows the whole page.",
  // the round modeler
  preMoney: "The valuation before the round: what the company is said to be worth before the new money arrives. Divided by the existing shares, it sets the price of one share.",
  newMoney: "How much the new investor pays in this round. It buys new shares at the round price.",
  optionPool: "Shares set aside to give employees later as options. A bigger pool leaves less for the existing owners, so it dilutes them.",
  founderShares: "Shares a founder already holds before this round.",
  unissuedPool: "Option-pool shares that nobody has received yet.",
  safe: "A SAFE is an early investment note: the investor pays now and gets shares later, at the next priced round, usually at a discount or under a valuation cap.",
  safePaid: "The money the early investor paid in for the SAFE.",
  valuationCap: "The highest valuation at which the SAFE converts. A low cap gives the early investor more shares.",
  discount: "A percentage off the new round's price that the SAFE investor gets when the SAFE converts.",
  roundPrice: "The price of one new share in this round, worked out exactly from the valuation, the option pool and the SAFEs.",
  poolTopUp: "New option-pool shares created so the pool is the size you asked for after the round.",
  dilution: "How many percentage points the founders' ownership falls because new shares were issued.",
  regime: "Whether the SAFE converted at its cap price or its discount price. The lower price wins, because it buys more shares.",
  convPrice: "The price per share at which the SAFE converted into shares.",
  fullyDiluted: "Ownership counted over every share, including the unissued option pool and the converted SAFEs.",
  pricePaid: "What was paid per share for this holder's shares.",
  planHash: "A fingerprint (SHA-256) of the exact plan: the shares issued, who pays how much and the deadline. Change anything and the fingerprint changes, so an approval of one plan cannot be reused for another.",
  diff: "Ownership before and after the round on the same scale, so you can see at a glance who is diluted and by how many points.",
  // investors and employees
  paidIn: "The money this investor put in.",
  liqPref: "If the company is sold, preferred shareholders first get this back (1× means the amount they paid), or convert to common if that pays more.",
  valueAtRound: "Shares times the round price: what the stake is worth at this round's price.",
  vested: "The part of an employee's options they have earned so far. Nothing vests before the cliff, then it vests gradually until the end of the term.",
  cliff: "A waiting period (12 months here) before any options vest at all.",
  strike: "The price an employee pays per share when they exercise their options.",
  exercise: "To exercise is to buy the vested shares at the strike price.",
  // exit and payouts
  exit: "An exit is when the company is sold. The simulator shows how the sale price is shared between the holders.",
  converts: "A preferred holder takes whichever is bigger: their preference back, or converting to common and sharing the proceeds.",
  remainder: "Amounts under one cent that are left over because shares cannot be split exactly. They are reported, not hidden.",
  sharedPot: "A group's treasury paying money out to everyone who holds shares, in proportion to how many they hold.",
  // the chain
  escrow: "Money held by the contract (not by anyone's wallet) until the board approves. It is refunded if the round is cancelled.",
  officer: "An account allowed to propose rounds and payouts. An officer cannot approve them: only the board can.",
  board: "The group (a Sputnik DAO) that votes on a plan. It approves the plan's fingerprint, not a vague “yes”.",
  proposal: "A vote in the DAO. Each proposal is decoded here, so you can see what it would really do before you press Approve.",
  closeRound: "Once a round is approved and fully paid, anyone can close it: the contract then issues the shares.",
  verified: "PASS means the plan stored on the chain hashes to exactly the fingerprint the board approved, recomputed in your own browser.",
  // drafts and sign-offs
  draftLink: "The round's numbers packed into the part of the link after the # sign. Your browser never sends that part to a server, and it holds no account and no keys.",
  signoff: "Before the board votes, each holder signs (with their wallet) a message that names the plan fingerprint and their own row, to confirm the allocation. It is not legal consent.",
  deadline: "The date by which the round must be funded. It is part of the plan fingerprint, so it must be fixed before anyone signs off.",
  // confidential mode
  confidential: "Confidential mode keeps each holder's shares off the chain. Only a sealed fingerprint of the table and the totals are public, with a zero-knowledge proof that the hidden numbers add up.",
  merkleRoot: "One fingerprint (a Merkle root) that commits to every row of the private table without showing any of it.",
  zkProof: "A zero-knowledge proof: a mathematical proof that something is true (here, that the private holdings add up) without revealing the numbers.",
  holderKey: "A secret only the holder knows; it proves a payout is theirs. It can be derived from your wallet, so there is no file to lose.",
  claimFile: "Your place in the private table. It holds no secret and is only useful together with your key.",
  boardCheck: "The board opens the private table and re-seals it, to confirm it matches the fingerprint on the chain before voting.",
  relayer: "A service that submits your claim for you, so your own wallet never appears on the chain.",
  relayerFee: "A small fee taken out of your payout to pay whoever submitted your claim, so you need no gas and no setup.",
  freshAccount: "A brand-new account made in your browser to receive a payout without linking it to your main wallet.",
  encKey: "A public key derived from your wallet, so someone can seal data that only you can open.",
};

/** The ⓘ button. `label` is read out by screen readers ("What is …?"). Unknown keys draw nothing, so a typo can never break a page. */
export const hint = (key: string, label = ""): string => (HINTS[key] ? `<button type="button" class="hint" data-hint="${esc(key)}" aria-label="What is this? ${esc(label || key)}">i</button>` : "");

let pop: HTMLElement | null = null, current: HTMLElement | null = null, pinned = false;
function show(btn: HTMLElement) {
  const text = HINTS[btn.dataset.hint ?? ""]; if (!text) return;
  if (!pop) { pop = document.createElement("div"); pop.id = "hint-pop"; pop.setAttribute("role", "tooltip"); document.body.appendChild(pop); }
  pop.textContent = text; pop.style.display = "block"; current = btn;
  const r = btn.getBoundingClientRect(), w = Math.min(320, window.innerWidth - 24); pop.style.width = `${w}px`;
  const h = pop.offsetHeight, below = r.bottom + 8 + h < window.innerHeight || r.top < h + 16;
  pop.style.left = `${Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2))}px`;
  pop.style.top = `${below ? r.bottom + 8 : r.top - h - 8}px`;
  btn.setAttribute("aria-describedby", "hint-pop");
}
function hide() { if (pop) pop.style.display = "none"; current?.removeAttribute("aria-describedby"); current = null; pinned = false; }
/** One set of delegated listeners for the whole page: it works for hints drawn later (every panel redraws itself). */
export function initHints() {
  const hintOf = (t: EventTarget | null) => (t instanceof Element ? (t.closest(".hint") as HTMLElement | null) : null);
  document.addEventListener("mouseover", (e) => { const b = hintOf(e.target); if (b && !pinned) show(b); });
  document.addEventListener("mouseout", (e) => { if (hintOf(e.target) && !pinned) hide(); });
  document.addEventListener("focusin", (e) => { const b = hintOf(e.target); if (b) show(b); });
  document.addEventListener("focusout", (e) => { if (hintOf(e.target) && !pinned) hide(); });
  document.addEventListener("click", (e) => { const b = hintOf(e.target); if (b) { e.preventDefault(); if (pinned && current === b) hide(); else { show(b); pinned = true; } } else if (pinned) hide(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  window.addEventListener("scroll", () => { if (!pinned) hide(); }, { passive: true });
}
