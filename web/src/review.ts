// "Check before you vote": the board's proposals, decoded and re-checked against the chain, with the vote button next to the result.
// Works for any Sputnik DAO that is the board of a Rounds contract. Reading needs no wallet; voting and proposing do.
import { account, onAccount, send } from "./wallet";
import { call, esc, type ChainView } from "./chain";
import { toast, txLink } from "./actions";
import { suggestRole, reapplyRole } from "./roles";
import { verifyBoardCopyWithWallet, boardCopyState } from "./zkflow";
import { keyOnAccount } from "./signoff";
import { rowsOfPlan, evaluateSignoffs, parseBundle, type SignoffReport } from "../../src/engine/signoff";
import { reviewProposal, proposalText, deltaPts, type Proposal, type Review, type Diff } from "./review-core";

const chip = (s: string) => `<span class="chip ${esc(s.toLowerCase())}">${esc(s)}</span>`;
const lvl = (l: string) => (l === "pass" ? `<span class="pass">PASS</span>` : l === "fail" ? `<span class="fail">FAIL</span>` : `<span class="muted">note</span>`);
let unsub: (() => void) | null = null;

const PALETTE = ["#fafafa", "#3080ff", "#44ffa4", "#f99c00", "#d946ef", "#a1a1aa", "#2ca86c", "#ff6b6b"];
const pct1 = (a: bigint, t: bigint) => (t === 0n ? "0.0" : `${(a * 1000n) / t / 10n}.${((a * 1000n) / t) % 10n}`);
/** Two stacked bars, before and after, on the same 100% scale, and one line per holder with the change in points: dilution at a glance. */
export function diffHtml(d: Diff): string {
  const col = (i: number) => PALETTE[i % PALETTE.length];
  const bar = (key: "before" | "after", total: bigint) => `<div class="bar" role="img" aria-label="${esc(key)}: ${d.holders.map((h) => `${esc(h.holder)} ${pct1(h[key], total)}%`).join(", ")}">${d.holders.map((h, i) => h[key] > 0n ? `<div style="flex:${Number((h[key] * 10000n) / (total || 1n)) || 1};background:${col(i)}" title="${esc(h.holder)} ${pct1(h[key], total)}%"></div>` : "").join("")}</div>`;
  return `<div class="diff"><p class="muted" style="margin:12px 0 4px">Who owns what, before and after (same scale)</p>
    <div class="barlab"><span>Before</span><span>${d.totalBefore.toLocaleString("en-US")} shares</span></div>${bar("before", d.totalBefore)}
    <div class="barlab"><span>After</span><span>${d.totalAfter.toLocaleString("en-US")} shares</span></div>${bar("after", d.totalAfter)}
    <ul class="diff-l">${d.holders.map((h, i) => { const dl = deltaPts(h.before, d.totalBefore, h.after, d.totalAfter); const neg = dl.startsWith("-"), pos = dl.startsWith("+");
      return `<li><i style="background:${col(i)}"></i><span class="diff-n">${esc(h.holder)}</span><span class="n">${pct1(h.before, d.totalBefore)}% → ${pct1(h.after, d.totalAfter)}%</span><span class="n ${neg ? "fail" : pos ? "pass" : "muted"}">${esc(dl)} pts</span></li>`; }).join("")}</ul></div>`;
}

/** What sits next to the Approve button besides the hash check: investors' sign-offs (public rounds) or the sealed table's check (confidential rounds). */
interface Extra { roundId?: number; signoff?: SignoffReport | null; zk?: { state: "ok" | "bad" | "unknown"; sealed: boolean } }
function extraHtml(x: Extra): string {
  let h = "";
  if (x.signoff) { const s = x.signoff; h += `<div class="rv-f"><div>${s.all ? `<span class="pass">ALL INVESTORS CONFIRMED</span>` : `<span class="muted">note</span>`} Investor sign-offs: <b>${s.confirmed} of ${s.total}</b> holders confirmed their own row of this exact plan${s.all ? "" : `. Not confirmed: ${esc(s.rows.filter((q) => q.status !== "confirmed").map((q) => q.account + (q.status === "invalid" ? ` (${(q as any).reason})` : "")).join(", "))}`}.${s.unsigned.length ? ` No signer possible for: ${esc(s.unsigned.join(", "))}.` : ""} <span class="muted">A confirmed allocation is not legal consent.</span></div></div>`; }
  else if (x.signoff === null) h += `<div class="rv-f"><div><span class="muted">note</span> No investor sign-offs were committed for this round, so nobody has confirmed their own row.</div></div>`;
  if (x.zk) h += `<div class="rv-f"><div>${x.zk.state === "ok" ? `<span class="pass">TABLE MATCHES ON-CHAIN ROOT</span> the private table you opened re-seals to this round's root.` : x.zk.state === "bad" ? `<span class="fail">TABLE DOES NOT MATCH</span> what you opened does not re-seal to this round's root. Do not approve.` : `<span class="muted">not checked</span> ${x.zk.sealed ? `<button class="btn sm" data-zkverify="${x.roundId}">Decrypt &amp; verify with my wallet</button>` : "No wallet-sealed copy is on chain: use the Board check (file) in the Confidential section."}`}</div></div>`;
  return h;
}
function card(r: Review, canVote: boolean, voted: boolean, x: Extra = {}): string {
  const bad = x.zk?.state === "bad";
  const vote = r.status !== "InProgress" ? "" :
    bad ? `<button class="btn sm" disabled title="The private table does not match the root in this vote">Do not approve: the table does not match</button>` :
    r.verdict === "mismatch" ? `<button class="btn sm" disabled title="The hash or terms in this vote do not match the chain">Do not approve: it does not match</button>`
    : `<button class="btn ${r.verdict === "match" ? "primary " : ""}sm" data-vote="${r.id}" ${canVote && !voted ? "" : "disabled"}>${voted ? "You already voted" : canVote ? (r.verdict === "match" ? "Approve this exact plan" : "Approve (nothing to re-check)") : "Only board members can vote"}</button>`;
  return `<div class="rv" id="proposal-${r.id}"><div class="rv-h"><b>#${r.id}</b> ${chip(r.status)} <b>${esc(r.title)}</b> ${r.verdict === "match" ? `<span class="pass">VERIFIED</span>` : r.verdict === "mismatch" ? `<span class="fail">DOES NOT MATCH</span>` : ""}</div>
    ${r.lines.length ? `<ul class="rv-l">${r.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
    <div class="rv-f">${r.findings.map((f) => `<div>${lvl(f.level)} ${esc(f.text)}</div>`).join("")}</div>
    ${extraHtml(x)}
    ${r.diff ? diffHtml(r.diff) : ""}
    ${r.table ? `<p class="muted" style="margin:12px 0 4px">${esc(r.table.title)}</p><table><tr>${r.table.head.map((h, i) => `<th${i ? ' class="n"' : ""}>${esc(h)}</th>`).join("")}</tr>${r.table.rows.map((row) => `<tr>${row.map((c, i) => `<td${i ? ' class="n"' : ' class="mono"'}>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>` : ""}
    <p class="muted" style="margin:10px 0 0">Proposer's own description (never used for the checks above): “${esc(r.description.slice(0, 400))}” · proposed by <span class="mono">${esc(r.proposer)}</span></p>
    ${r.call ? `<details class="gloss"><summary>The raw call</summary><pre class="out">${esc(r.call.receiver)} . ${esc(r.call.method)}(${esc(r.call.argsText.slice(0, 1500))})</pre></details>` : ""}
    ${vote ? `<div style="margin-top:10px">${vote}</div>` : ""}</div>`;
}

export async function renderReview(host: HTMLElement, v: ChainView, rpc: string, explorer: string, reload: () => void) {
  unsub?.();
  let policy: any = null, last = -1;
  try { [policy, last] = await Promise.all([call(rpc, v.board, "get_policy", {}), call(rpc, v.board, "get_last_proposal_id", {})]); }
  catch { host.innerHTML = `<p class="note">${esc(v.board)} has no proposal list to read (it is not a Sputnik DAO; an open sandbox board has no votes). Nothing to review here.</p>`; return; }
  const props: Proposal[] = last > 0 ? await call(rpc, v.board, "get_proposals", { from_index: Math.max(0, last - 40), limit: 40 }) : [];
  // proposals that call the Rounds contract, or the treasury paying into it
  const mine = props.filter((p) => { const r = p.kind?.FunctionCall?.receiver_id; return r === v.contract || r === v.token || (!!v.projectToken && r === v.projectToken); }).reverse();
  const reviews = await Promise.all(mine.map((p) => reviewProposal(p, v)));
  const open = reviews.filter((r) => r.status === "InProgress"), past = reviews.filter((r) => r.status !== "InProgress");
  const bond = String(policy.proposal_bond ?? "100000000000000000000000");
  // per open "approve a round" vote: the investors' sign-offs (a public round) or the sealed table's state (a confidential round)
  const extras = new Map<number, Extra>();
  for (const r of open) {
    if (r.call?.method !== "approve_round") continue;
    const roundId = Number(JSON.parse(r.call.argsText).round_id), rd = v.rounds.find((q) => q.id === roundId); if (!rd) continue;
    let plan: any = null; try { plan = JSON.parse(rd.plan); } catch { /* unreadable: no extras */ }
    if (plan && typeof plan.merkle_root === "string") { let sealed = false; try { sealed = !!(await call(rpc, v.contract, "board_envelope", { round_id: roundId })); } catch { /* an older contract */ } extras.set(r.id, { roundId, zk: { state: boardCopyState(v.contract, roundId), sealed } }); }
    else if (plan) { try { const text: string | null = await call(rpc, v.contract, "signoffs_of", { round_id: roundId }); extras.set(r.id, { roundId, signoff: text ? await evaluateSignoffs(parseBundle(text), rowsOfPlan(rd.plan), v.contract, rd.plan_hash, keyOnAccount(rpc)) : null }); } catch { /* an older contract has no sign-offs */ } }
  }

  const draw = (acct: string | null) => {
    const council = !!acct && (policy.roles ?? []).some((r: any) => (r.kind?.Group ?? []).includes(acct));
    if (council) suggestRole("board");
    const votedBy = (id: number) => !!acct && !!props.find((p) => p.id === id)?.votes?.[acct];
    // rounds waiting for approval that nobody has put to a vote yet: a board member can propose them with a readable description
    const queued = new Set(open.filter((r) => r.call?.method === "approve_round").map((r) => String(JSON.parse(r.call!.argsText).round_id)));
    const toPropose = v.rounds.filter((r) => r.status === "Funding" && !queued.has(String(r.id)));
    const link = `${location.origin}${location.pathname}?contract=${encodeURIComponent(v.contract)}#review`;
    host.innerHTML = `<p class="note">A Sputnik proposal shows a free-text description and an unreadable hash. Here each proposal is decoded, its hash is recomputed in your browser against the plan the contract holds, and what it would change is shown in numbers. The proposer's description is not trusted. ${acct ? (council ? "You are on this board." : "You are not on this board, so you can read but not vote.") : "Connect a wallet to vote."}</p>
      ${open.length ? `<div class="chain-h"><span class="mono muted">OPEN FOR VOTES</span></div>${open.map((r) => card(r, council, votedBy(r.id), extras.get(r.id))).join("")}` : `<p class="note"><b>No proposals are open for votes.</b></p>`}
      ${council && toPropose.length ? `<div class="chain-h"><span class="mono muted">PUT A ROUND TO THE BOARD</span></div>${toPropose.map((r) => `<div class="act"><div><b>Round ${r.id}</b> awaits approval<br/><span class="muted">${esc(proposalText(r, link)).slice(0, 220)}…</span></div><button class="btn sm" data-propose="${r.id}">Propose to the board</button></div>`).join("")}<p class="note">This writes the description from the plan itself and links back here, so voters in any DAO tool can read what they are voting on. The proposal carries a bond set by the DAO.</p>` : ""}
      ${past.length ? `<details class="gloss" ${open.length ? "" : "open"}><summary>Earlier proposals of this board (${past.length}), each re-checked against the chain now</summary>${past.map((r) => card(r, false, false)).join("")}</details>` : ""}`;
    reapplyRole();
    host.querySelectorAll<HTMLButtonElement>("button[data-zkverify]").forEach((b) => b.onclick = async () => {
      const id = Number(b.dataset.zkverify); b.disabled = true;
      try { toast("Your wallet will ask you to sign a fixed message to unlock your key (nothing is sent)."); const out = await verifyBoardCopyWithWallet({ rpc, contract: v.contract }, id); for (const e of extras.values()) if (e.roundId === id && e.zk) e.zk.state = out.ok ? "ok" : "bad"; toast(out.ok ? `<span class="pass">PASS</span> ${esc(out.message)}` : `<span class="fail">FAIL</span> ${esc(out.message)}`, out.ok ? "ok" : "fail"); draw(account()); }
      catch (e) { toast(`<span class="fail">FAIL</span> ${esc((e as Error).message)}`, "fail"); b.disabled = false; }
    });
    host.querySelectorAll<HTMLButtonElement>("button[data-vote]").forEach((b) => b.onclick = async () => {
      const id = Number(b.dataset.vote); b.disabled = true;
      try { toast(`Waiting for your wallet to approve your vote on proposal #${id} …`); const r = await send(v.board, [{ method: "act_proposal", args: { id, action: "VoteApprove" }, gasTgas: 200 }]); if (r.hash) { toast(`<span class="pass">DONE</span> your vote on #${id}: ${txLink(explorer, r.hash)}`, "ok"); reload(); } }
      catch (e) { toast(`<span class="fail">FAIL</span> ${esc((e as Error).message)}`, "fail"); b.disabled = false; }
    });
    host.querySelectorAll<HTMLButtonElement>("button[data-propose]").forEach((b) => b.onclick = async () => {
      const r = v.rounds.find((x) => String(x.id) === b.dataset.propose)!; b.disabled = true;
      const args = btoa(JSON.stringify({ round_id: r.id, plan_hash: r.plan_hash }));
      const proposal = { proposal: { description: proposalText(r, link), kind: { FunctionCall: { receiver_id: v.contract, actions: [{ method_name: "approve_round", args, deposit: "0", gas: "60000000000000" }] } } } };
      try { toast(`Waiting for your wallet to approve: propose round ${r.id} to the board …`); const s = await send(v.board, [{ method: "add_proposal", args: proposal, gasTgas: 100, depositYocto: bond }]); if (s.hash) { toast(`<span class="pass">DONE</span> proposed to the board: ${txLink(explorer, s.hash)}`, "ok"); reload(); } }
      catch (e) { toast(`<span class="fail">FAIL</span> ${esc((e as Error).message)}`, "fail"); b.disabled = false; }
    });
  };
  unsub = onAccount((a) => draw(a)); void account;
}
