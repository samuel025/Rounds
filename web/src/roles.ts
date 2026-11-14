// Role views: one page, three lenses. A role only decides what is SHOWN; it never gates anything, since on chain anyone may call anything the
// contract allows and the same transactions exist in every view. "Everything" is the full page.
//   founder  = whoever builds and proposes a round        board    = someone who votes on a plan
//   investor = a holder who deposits, checks and claims   all      = every section (the original layout)
// Elements opt in with data-roles="founder board" (a space-separated list); elements without the attribute show in every role.
// Elements with class "tech" (hashes, raw calls, proof internals) are shown in the investor view only inside the "Technical proof" toggle.
import { hint } from "./hints";
export type Role = "founder" | "board" | "investor" | "all";
export const ROLES: { id: Role; label: string; hint: string }[] = [
  { id: "founder", label: "Founder / proposer", hint: "Model a round, share a draft, collect sign-offs, propose it" },
  { id: "board", label: "Board voter", hint: "Check a proposal and see who gets diluted before you vote" },
  { id: "investor", label: "Investor / employee", hint: "See your stake, deposit to escrow, claim a payout" },
  { id: "all", label: "Everything", hint: "The full page, every section" },
];
const CARDS: { id: Role; title: string; who: string; does: string; go: string }[] = [
  { id: "founder", title: "Founder / proposer", who: "You run the company or the round.", does: "Model a round, share a draft with investors, collect their sign-offs and propose it to the board.", go: "model" },
  { id: "board", title: "Board voter", who: "You sit on the DAO that approves rounds.", does: "Check what a proposal really does, see who gets diluted, then vote.", go: "verify" },
  { id: "investor", title: "Investor / employee", who: "You hold, or will hold, shares.", does: "See your stake, deposit to escrow, follow your vesting and claim a payout.", go: "people" },
];
const KEY = "rounds.role", TECH = "rounds.tech";
const store = { get(k: string) { try { return localStorage.getItem(k); } catch { return null; } }, set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } } };
let current: Role = "founder"; let explicit = false;
const isRole = (x: unknown): x is Role => ROLES.some((r) => r.id === x);
export const getRole = () => current;

/** Does an element with this data-roles value show in this role? No attribute = always. */
export const visibleIn = (roles: string | null | undefined, role: Role) => role === "all" || !roles || roles.split(/\s+/).includes(role);

export function applyRole(role: Role, root: ParentNode = document) {
  current = role; document.body.dataset.role = role;
  root.querySelectorAll<HTMLElement>("[data-roles]").forEach((el) => el.classList.toggle("role-off", !visibleIn(el.dataset.roles, role)));
  document.querySelectorAll<HTMLButtonElement>("#rolebar [data-role]").forEach((b) => { const on = b.dataset.role === role; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
  const hint = document.getElementById("role-hint"); if (hint) hint.textContent = ROLES.find((r) => r.id === role)?.hint ?? "";
  document.querySelectorAll<HTMLButtonElement>("#role-pick .rp-card").forEach((b) => { const on = b.dataset.role === role; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
  document.getElementById("role-pick")?.classList.toggle("first", !explicit);
  const cur = document.getElementById("rp-cur"); if (cur) cur.innerHTML = explicit || role !== "founder" ? `Viewing as <b>${ROLES.find((r) => r.id === role)?.label}</b>` : "Not chosen yet: showing the founder view";
  window.dispatchEvent(new Event("rounds:role")); // panels that draw their own tabs (the confidential card) follow the view
  const tech = document.getElementById("tech-wrap"); if (tech) tech.style.display = role === "investor" ? "flex" : "none";
}
export function setRole(role: Role, userChoice = true) { if (userChoice) { explicit = true; store.set(KEY, role); } applyRole(role); }

/** A role inferred from the connected account is only a suggestion: it never overrides a choice the person made. */
export function suggestRole(role: Role) { if (!explicit && store.get(KEY) === null) applyRole(role); }

export function initRoles() {
  const saved = store.get(KEY); explicit = isRole(saved); current = isRole(saved) ? saved : "founder";
  const bar = document.getElementById("rolebar"); if (!bar) return;
  bar.innerHTML = `<div class="wrap rolebar-in"><span class="mono rb-lab">VIEWING AS</span><div class="rolebtns" role="group" aria-label="Choose your view">${ROLES.map((r) => `<button class="tab" data-role="${r.id}" aria-pressed="false">${r.label}</button>`).join("")}</div><span class="muted" id="role-hint" style="font-size:12.5px"></span>
    <label id="tech-wrap" class="muted" style="font-size:12.5px;display:none;gap:6px;align-items:center;margin-left:auto"><input type="checkbox" id="tech-toggle" style="width:auto"/> Technical proof</label></div>`;
  bar.querySelectorAll<HTMLButtonElement>("[data-role]").forEach((b) => (b.onclick = () => setRole(b.dataset.role as Role)));
  const tt = bar.querySelector<HTMLInputElement>("#tech-toggle")!; tt.checked = store.get(TECH) === "1"; document.body.dataset.tech = tt.checked ? "1" : "";
  tt.onchange = () => { document.body.dataset.tech = tt.checked ? "1" : ""; store.set(TECH, tt.checked ? "1" : "0"); };
  const pick = document.getElementById("role-pick");
  if (pick) {
    pick.innerHTML = `<div class="card-h"><span class="mono muted">START HERE · WHO ARE YOU?${hint("roles", "the role choice")}</span><span class="muted" id="rp-cur"></span></div>
      <div class="rp-grid">${CARDS.map((c) => `<button class="rp-card" data-role="${c.id}" data-go="${c.go}" aria-pressed="false"><b>${c.title}</b><span class="rp-who">${c.who}</span><span class="rp-does">${c.does}</span><span class="rp-cta">Show me this view →</span></button>`).join("")}</div>
      <p class="note" style="margin:12px 0 0">Pick one to see only what matters to you. Nothing is locked, and you can switch at any time in the bar at the top. <button class="linkbtn" data-role="all" id="rp-all">Show me everything</button></p>`;
    pick.querySelectorAll<HTMLButtonElement>(".rp-card").forEach((b) => (b.onclick = () => { setRole(b.dataset.role as Role); setTimeout(() => document.getElementById(b.dataset.go!)?.scrollIntoView({ behavior: "smooth", block: "start" }), 120); }));
    (pick.querySelector("#rp-all") as HTMLButtonElement).onclick = () => setRole("all");
  }
  applyRole(current);
  // a link to a section the current view hides (#zk, #exit, a shared round link) switches to a view that shows it instead of going nowhere
  const follow = () => { const id = location.hash.replace(/^#/, "").split("/")[0]; const el = id ? document.getElementById(id) : null; if (!el) return;
    const holder = el.closest<HTMLElement>("[data-roles]"); if (holder && !visibleIn(holder.dataset.roles, current)) { const first = (holder.dataset.roles ?? "").split(/\s+/).find(isRole); applyRole((first as Role) ?? "all"); el.scrollIntoView(); } };
  window.addEventListener("hashchange", follow); setTimeout(follow, 0);
}
/** Re-apply after sections are redrawn (the chain panels are rebuilt on every refresh). */
export const reapplyRole = () => applyRole(current);
