// "Check before you vote": turns a Sputnik DAO proposal into what it will really do, and re-checks the hash it approves
// against the plan the Rounds contract holds. Pure functions (no DOM, no network) so they can be tested; review.ts draws them.
// Nothing here trusts the proposer's description: the verdict comes from decoding the call and recomputing hashes.
import { planHash, canonicalJson, convertSaft } from "../../src/engine/index";
import { usdExact, price4 } from "./format";
import type { ChainView, RoundRec } from "./chain";

export interface Proposal { id: number; proposer: string; description: string; kind: any; status: string; votes?: Record<string, string>; vote_counts?: Record<string, number[]> }
export interface Finding { level: "pass" | "fail" | "info"; text: string }
export interface Table { title: string; head: string[]; rows: string[][] }
export interface Review {
  id: number; status: string; description: string; proposer: string;
  /** one line: what the vote does */ title: string; lines: string[]; findings: Finding[]; table?: Table;
  call?: { receiver: string; method: string; argsText: string };
  /** ownership before and after, for the dilution bars (public rounds only; a confidential round's table is sealed) */
  diff?: Diff;
  /** match: a hash in the vote was re-checked and equals the plan; mismatch: something does not add up; unchecked: nothing to re-check */
  verdict: "match" | "mismatch" | "unchecked";
}

export interface Diff { holders: { holder: string; before: bigint; after: bigint }[]; totalBefore: bigint; totalAfter: bigint }
const M = 1_000_000n;
const n = (x: bigint | string) => BigInt(x).toLocaleString("en-US");
const POOL = "unissued_pool";
const label = (h: string) => (h === POOL ? "Option pool (unissued)" : h);
const pct = (a: bigint, total: bigint) => (total === 0n ? "0.00%" : `${(a * 10000n / total / 100n).toString()}.${((a * 10000n / total) % 100n).toString().padStart(2, "0")}%`);

export function decodeArgs(b64: string): { json: any; text: string } {
  let text = "";
  try { text = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); } catch { return { json: null, text: `(not base64: ${b64.slice(0, 80)})` }; }
  try { return { json: JSON.parse(text), text }; } catch { return { json: null, text }; }
}

/** The shares (by holder) the plan issues, and the plan parsed. */
function planOf(r: RoundRec): any | null { try { return JSON.parse(r.plan); } catch { return null; } }

/** Plain-language description of a round: who pays what, what is issued, the implied price. */
export function describeRound(r: RoundRec): { title: string; lines: string[] } {
  const p = planOf(r); const lines: string[] = [];
  if (!p) return { title: `Round ${r.id}: the plan on chain cannot be read`, lines };
  if (typeof p.merkle_root === "string") { // a confidential round: the cap table is sealed, only the root and the total are public
    const total = r.raise.reduce((a, [, x]) => a + BigInt(x), 0n);
    for (const [who, amt] of r.raise) lines.push(`${who} pays ${usdExact(BigInt(amt))} into escrow (deposits are public)`);
    lines.push(`seals a private cap table of ${n(p.total_shares)} shares under the root ${String(p.merkle_root).slice(0, 14)}…; no holding is on chain`);
    lines.push(p.escrow_hash ? `commits to an encrypted copy of the table for the board (hash ${String(p.escrow_hash).slice(0, 12)}…)` : "commits to no encrypted copy of the table for the board");
    return { title: `Approve confidential round ${r.id}${total > 0n ? ` (${usdExact(total)} raised)` : ""}`, lines };
  }
  const issued: Record<string, bigint> = {};
  for (const i of p.issuances ?? []) issued[i.holder] = (issued[i.holder] ?? 0n) + BigInt(i.shares);
  for (const [who, amt] of r.raise) {
    const sh = issued[who] ?? 0n;
    lines.push(`${who} pays ${usdExact(BigInt(amt))} into escrow${sh > 0n ? ` and receives ${n(sh)} shares at ${price4(BigInt(amt) / sh)} a share` : ""}`);
  }
  for (const s of p.safes ?? []) lines.push(`SAFE ${s.id}: ${s.holder} invests ${usdExact(BigInt(s.amount))} with a ${usdExact(BigInt(s.post_money_cap))} post-money cap${s.discount_bps ? ` and a ${s.discount_bps / 100}% discount` : ""}`);
  for (const i of p.issuances ?? []) lines.push(`issues ${n(i.shares)} ${i.class} to ${label(i.holder)}`);
  if ((p.converted_safes ?? []).length) lines.push(`converts ${(p.converted_safes as string[]).join(", ")} into shares`);
  const kind = typeof r.kind === "string" ? r.kind : JSON.stringify(r.kind);
  const total = r.raise.reduce((a, [, x]) => a + BigInt(x), 0n);
  return { title: `Approve ${kind} round ${r.id}${total > 0n ? ` (${usdExact(total)} raised)` : ""}`, lines };
}

/** One sentence a proposer can put in the DAO proposal's description so it is readable in any DAO tool. */
export function proposalText(r: RoundRec, link: string): string {
  const d = describeRound(r); const hash = r.plan_hash.slice(0, 12);
  return `${d.title}: ${d.lines.slice(0, 4).join("; ")}. Plan hash ${hash}…. Check it before voting: ${link}`.slice(0, 900);
}

/** Holdings before and after the round, per holder (all classes together). */
/** Holdings before and after, as a table and as numbers for the before/after bars. */
export function ownershipOf(v: ChainView, r: RoundRec): { table: Table; diff: Diff } | undefined {
  const p = planOf(r); if (!p) return undefined;
  const now: Record<string, bigint> = {}, add: Record<string, bigint> = {};
  for (const [h, , s] of v.holdings) now[h] = (now[h] ?? 0n) + BigInt(s);
  for (const i of p.issuances ?? []) add[i.holder] = (add[i.holder] ?? 0n) + BigInt(i.shares);
  if (!Object.keys(add).length) return undefined;
  const applied = r.status === "Closed"; // a closed round is already in the cap table
  const before: Record<string, bigint> = {}, after: Record<string, bigint> = {};
  for (const h of new Set([...Object.keys(now), ...Object.keys(add)])) {
    after[h] = applied ? (now[h] ?? 0n) : (now[h] ?? 0n) + (add[h] ?? 0n);
    before[h] = after[h] - (add[h] ?? 0n);
  }
  const total = Object.values(after).reduce((a, b) => a + b, 0n);
  const hs = Object.keys(after).filter((h) => after[h] > 0n || before[h] > 0n).sort((a, b) => (after[b] > after[a] ? 1 : after[b] < after[a] ? -1 : a < b ? -1 : 1));
  const totalBefore = hs.reduce((a, h) => a + before[h], 0n);
  return { diff: { holders: hs.map((h) => ({ holder: label(h), before: before[h], after: after[h] })), totalBefore, totalAfter: total },
    table: { title: applied ? "Ownership after this round (already applied)" : "Ownership if this round is approved and closed", head: ["Holder", "Before", "This plan issues", "After", "Share after"],
    rows: hs.map((h) => [label(h), n(before[h]), (add[h] ?? 0n) > 0n ? `+${n(add[h] ?? 0n)}` : "", n(after[h]), pct(after[h], total)]) } };
}

/** Change in ownership in percentage points, one decimal (half away from zero): "-12.3". Exact integer arithmetic on basis points. */
export function deltaPts(before: bigint, totalBefore: bigint, after: bigint, totalAfter: bigint): string {
  const bps = (a: bigint, t: bigint) => (t === 0n ? 0n : (a * 100_000n) / t); // hundredths of a basis point: floor
  const d = bps(after, totalAfter) - bps(before, totalBefore); const abs = d < 0n ? -d : d;
  const tenths = (abs + 50n) / 100n; // 1000 units = 1 pt; round to 0.1 pt
  return `${d < 0n && tenths > 0n ? "-" : d > 0n && tenths > 0n ? "+" : ""}${tenths / 10n}.${tenths % 10n}`;
}

const bad = (text: string): Finding => ({ level: "fail", text });
const ok = (text: string): Finding => ({ level: "pass", text });
const info = (text: string): Finding => ({ level: "info", text });

export async function reviewProposal(p: Proposal, v: ChainView): Promise<Review> {
  const base = { id: p.id, status: p.status, description: p.description ?? "", proposer: p.proposer, lines: [] as string[], findings: [] as Finding[] };
  const done = (title: string, extra: Partial<Review> = {}): Review => {
    const r = { ...base, title, ...extra } as Review;
    r.verdict = r.findings.some((f) => f.level === "fail") ? "mismatch" : r.findings.some((f) => f.level === "pass") ? "match" : "unchecked";
    return r;
  };
  const fc = p.kind?.FunctionCall;
  if (!fc || !Array.isArray(fc.actions) || !fc.actions.length) {
    const k = typeof p.kind === "string" ? p.kind : Object.keys(p.kind ?? {})[0] ?? "unknown";
    base.findings.push(info(`This is a "${k}" proposal, not a call to the Rounds contract, so there is no plan hash to re-check.`));
    return done(`${k} proposal`);
  }
  const act = fc.actions[0]; const receiver: string = fc.receiver_id, method: string = act.method_name;
  const { json: a, text } = decodeArgs(act.args ?? "");
  const call = { receiver, method, argsText: text };
  base.findings.push(...(fc.actions.length > 1 ? [bad(`The proposal contains ${fc.actions.length} actions; only the first is shown here. Read the others before voting.`)] : []));
  if (a === null) { base.findings.push(bad("The call's arguments are not readable JSON.")); return done(`Calls ${method} on ${receiver}`, { call }); }

  if (receiver === v.contract && method === "approve_round") {
    const r = v.rounds.find((x) => x.id === a.round_id);
    if (!r) { base.findings.push(bad(`Round ${a.round_id} does not exist on ${v.contract}.`)); return done(`Approve round ${a.round_id}`, { call }); }
    const d = describeRound(r);
    const local = await planHash(r.plan);
    base.findings.push(a.plan_hash === r.plan_hash ? ok(`The hash in this vote is the hash the contract holds for round ${r.id}.`) : bad(`The hash in this vote (${String(a.plan_hash).slice(0, 12)}…) is NOT the hash the contract holds for round ${r.id} (${r.plan_hash.slice(0, 12)}…). The contract would refuse it.`));
    base.findings.push(local === r.plan_hash ? ok("The plan stored on chain hashes to exactly that fingerprint (recomputed here, in your browser).") : bad("The plan stored on chain does NOT hash to its fingerprint."));
    const p0 = planOf(r);
    if (p0 && Array.isArray(p0.raise)) base.findings.push(JSON.stringify(p0.raise) === JSON.stringify(r.raise) && p0.kind === r.kind ? ok("The investors and amounts the contract will collect are the ones inside the approved plan.") : bad("The investors or amounts differ from the ones inside the plan."));
    else base.findings.push(info("This contract is an older build: its hash covers the shares issued, not the money terms."));
    if (r.status !== "Funding") base.findings.push(info(`The round is already ${r.status}.`));
    if (p0 && typeof p0.merkle_root === "string") base.findings.push(info("The cap table is sealed, so the numbers cannot be shown here. Before voting, open the Board check in the Confidential mode section with the table file the proposer gave you: it re-seals the table and compares it with this root."));
    const funded = r.raise.every(([, amt], k) => BigInt(r.deposits[k]?.[1] ?? "0") === BigInt(amt));
    if (r.raise.length) base.findings.push(info(funded ? "Every investor has paid into escrow." : "Not every investor has paid into escrow yet."));
    const own = ownershipOf(v, r);
    return done(d.title, { lines: d.lines, table: own?.table, diff: own?.diff, call });
  }

  if (receiver === v.contract && method === "approve_exit") {
    const e: any = v.exits.find((x) => x.id === a.exit_id);
    if (!e) { base.findings.push(bad(`Exit ${a.exit_id} does not exist on ${v.contract}.`)); return done(`Approve exit ${a.exit_id}`, { call }); }
    const rebuilt = canonicalJson({ payouts: (e.payouts as any[]).map((q) => [q.holder, String(q.amount)]) });
    const local = await planHash(rebuilt);
    base.findings.push(a.plan_hash === e.plan_hash ? ok(`The hash in this vote is the hash the contract holds for exit ${e.id}.`) : bad(`The hash in this vote is NOT the hash the contract holds for exit ${e.id}.`));
    base.findings.push(local === e.plan_hash ? ok("The payouts listed below hash to exactly that fingerprint (recomputed here, in your browser).") : bad("The payouts the contract holds do NOT hash to the fingerprint."));
    const total = BigInt(e.total), funded = BigInt(e.funded);
    base.findings.push(info(funded === total ? "The exit is fully funded." : `Funded ${usdExact(funded)} of ${usdExact(total)}; it cannot be paid out until it is fully funded.`));
    if (e.cancelled) base.findings.push(bad("This exit was cancelled."));
    return done(`Approve exit ${e.id} (${usdExact(total)} paid to ${(e.payouts as any[]).length} accounts)`,
      { call, lines: [`pays ${usdExact(total)} in total, each account once`], table: { title: "Payouts", head: ["Account", "Amount", "State"], rows: (e.payouts as any[]).map((q) => [q.holder, usdExact(BigInt(q.amount)), String(q.state)]) } });
  }

  if (receiver === v.contract && method === "grant") {
    const local = await planHash(String(a.plan ?? ""));
    base.findings.push(local === a.plan_hash ? ok("The grant's terms below hash to exactly the fingerprint in this vote (recomputed here, in your browser).") : bad("The grant's terms do NOT hash to the fingerprint in this vote. The contract would refuse it."));
    let g: any = null; try { g = JSON.parse(a.plan); } catch { /* shown as unreadable */ }
    if (!g) { base.findings.push(bad("The grant's terms are not readable.")); return done("Grant options", { call }); }
    const start = (() => { try { return new Date(Number(BigInt(g.start_ns) / 1_000_000n)).toISOString().slice(0, 10); } catch { return "?"; } })();
    return done(`Grant ${n(g.shares)} options to ${g.grantee}`, { call, lines: [
      `${g.grantee} may buy ${n(g.shares)} shares at ${price4(BigInt(g.strike_micro))} each`,
      `vesting starts ${start}, runs ${g.term_months} months, nothing before month ${g.cliff_months}`,
      "the shares come out of the unissued option pool; the contract refuses a grant larger than what is left in it"] });
  }

  if (receiver === v.contract && method === "convert_safts") {
    const local = await planHash(String(a.plan ?? ""));
    base.findings.push(local === a.plan_hash ? ok("The plan below hashes to exactly the fingerprint in this vote (recomputed here, in your browser).") : bad("The plan does NOT hash to the fingerprint in this vote. The contract would refuse it."));
    let p: any = null; try { p = JSON.parse(a.plan); } catch { /* shown as unreadable */ }
    if (!p?.conversions || !p?.tge) { base.findings.push(bad("The conversion plan is not readable.")); return done("Convert SAFTs to tokens", { call }); }
    const dec = Number(p.tge.decimals ?? 0), unit = 10n ** BigInt(dec);
    const whole = (units: bigint) => { const w = units / unit, f = (units % unit).toString().padStart(dec, "0").replace(/0+$/, ""); return `${w.toLocaleString("en-US")}${f ? "." + f : ""}`; };
    let allMatch = true, total = 0n; const rows: string[][] = [];
    for (const c of p.conversions) {
      let again: ReturnType<typeof convertSaft> | null = null;
      try { again = convertSaft({ id: c.id, holder: c.holder, amountMicro: BigInt(c.amount_micro), fdvCapMicro: BigInt(c.fdv_cap_micro), discountBps: Number(c.discount_bps) }, { totalSupply: BigInt(p.tge.total_supply), launchPriceMicro: BigInt(p.tge.launch_price_micro), decimals: dec }); } catch { /* shown as a mismatch */ }
      const match = !!again && again.tokens === BigInt(c.tokens) && again.regime === c.regime; if (!match) allMatch = false; total += BigInt(c.tokens);
      rows.push([c.id, c.holder, usdExact(BigInt(c.amount_micro)), c.regime, whole(BigInt(c.tokens)), again ? usdExact(again.price.num * unit / again.price.den) : "?", match ? "ok" : "DIFFERS"]);
    }
    base.findings.push(allMatch ? ok("Every token count was recomputed here from the SAFT terms in the plan (RULES.md R11) and matches.") : bad("At least one token count differs from the recomputation. The contract would refuse the plan."));
    base.findings.push(total <= BigInt(p.tge.total_supply) ? ok(`Together the SAFTs receive ${whole(total)} of ${whole(BigInt(p.tge.total_supply))} tokens.`) : bad("The SAFTs would receive more tokens than exist."));
    base.findings.push(info("The contract recomputes the same numbers from the SAFTs it stored when they were sold, so terms in this plan that differ from those are refused, and it checks that its token reserve covers every claim."));
    return done(`Convert ${p.conversions.length} SAFT(s) into ${whole(total)} tokens`, { call,
      lines: [`launch price ${usdExact(BigInt(p.tge.launch_price_micro))} a token; each holder's tokens then vest over ${p.vesting?.term_months} months, nothing before month ${p.vesting?.cliff_months}`],
      table: { title: "Conversions", head: ["SAFT", "Holder", "Paid", "Price rule", "Tokens", "Price per token", "Recomputed"], rows } });
  }

  if (receiver === v.contract && method === "grant_tokens") {
    const local = await planHash(String(a.plan ?? ""));
    base.findings.push(local === a.plan_hash ? ok("The grant's terms hash to exactly the fingerprint in this vote (recomputed here, in your browser).") : bad("The grant's terms do NOT hash to the fingerprint in this vote."));
    let g: any = null; try { g = JSON.parse(a.plan); } catch { /* shown as unreadable */ }
    if (!g) { base.findings.push(bad("The grant's terms are not readable.")); return done("Grant tokens", { call }); }
    const dec = v.tokenDecimals ?? 0, unit = 10n ** BigInt(dec), t = BigInt(g.tokens);
    const amount = `${(t / unit).toLocaleString("en-US")}${t % unit ? "." + (t % unit).toString().padStart(dec, "0").replace(/0+$/, "") : ""}`;
    base.findings.push(info("The contract refuses a grant larger than what is left in the token reserve after every other claim."));
    return done(`Grant ${amount} tokens to ${g.grantee}`, { call, lines: [`${g.grantee} may claim ${amount} tokens as they vest over ${g.term_months} months, nothing before month ${g.cliff_months}`, "the tokens come out of the reserve the DAO funded"] });
  }

  if (v.projectToken && receiver === v.projectToken && method === "ft_transfer_call") {
    let m: any = null; try { m = JSON.parse(a.msg); } catch { /* not a Rounds message */ }
    if (a.receiver_id === v.contract && m?.action === "reserve") {
      const dec = v.tokenDecimals ?? 0, t = BigInt(a.amount);
      base.findings.push(info("This moves project tokens from the DAO's treasury into the contract's token reserve. Grants and SAFT conversions can only promise what the reserve holds."));
      return done(`Put ${(t / 10n ** BigInt(dec)).toLocaleString("en-US")} project tokens into the token reserve`, { call, lines: [`${a.amount} token units leave the treasury for the reserve`] });
    }
  }

  if (receiver === v.token && method === "ft_transfer_call") {
    let m: any = null; try { m = JSON.parse(a.msg); } catch { /* not a Rounds message */ }
    if (a.receiver_id === v.contract && m?.action === "exit") {
      const e: any = v.exits.find((x) => x.id === m.id);
      if (!e) { base.findings.push(bad(`Exit ${m.id} does not exist on ${v.contract}.`)); return done(`Fund exit ${m.id}`, { call }); }
      base.findings.push(BigInt(a.amount) === BigInt(e.total) ? ok(`The amount equals the exit's total (${usdExact(BigInt(e.total))}).`) : bad(`The vote pays ${usdExact(BigInt(a.amount))} but exit ${e.id} totals ${usdExact(BigInt(e.total))}.`));
      base.findings.push(info("This moves money out of the DAO's treasury into the contract's escrow. It is paid to the holders only after the board also approves the exit's plan hash."));
      return done(`Pay ${usdExact(BigInt(a.amount))} from the treasury into exit ${e.id}`, { call, lines: [`${usdExact(BigInt(a.amount))} leaves the DAO's treasury and waits in escrow for exit ${e.id}`] });
    }
    base.findings.push(info("A token transfer from the treasury that is not a Rounds payment. Read the receiver and the message."));
    return done(`Treasury transfer of ${a.amount ?? "?"} to ${a.receiver_id ?? "?"}`, { call, lines: [`message: ${String(a.msg ?? "").slice(0, 200)}`] });
  }

  // other board methods of the contract: shown in words, nothing to re-hash
  if (receiver === v.contract) {
    const words: Record<string, string> = {
      set_officer: `${a.enabled ? "Make" : "Stop being"} ${a.account} ${a.enabled ? "an officer (may propose rounds and exits)" : "an officer"}`,
      cancel_round: `Cancel round ${a.round_id}: deposits are refunded`, cancel_exit: `Cancel exit ${a.exit_id}: funders can take their money back`,
      withdraw_strikes: `Send ${a.amount ? usdExact(BigInt(a.amount)) : "?"} of held exercise strikes to the treasury`, terminate: `Terminate grant ${a.grant_id}: unvested options lapse`,
      set_project_token: `Name ${a.token} (${a.decimals} decimals) as the project token, once; SAFTs can be converted and tokens granted only after this`, terminate_token_grant: `Terminate token grant ${a.grant_id}: unvested tokens return to the reserve's free balance`,
      add_class: `Authorize a new share class "${a.class?.id}" of up to ${a.class?.authorized ? n(a.class.authorized) : "?"} shares` };
    base.findings.push(info("This call carries no plan hash; what it does is described in words from its arguments."));
    return done(words[method] ?? `Calls ${method} on the Rounds contract`, { call, lines: [] });
  }
  base.findings.push(info(`A call to ${receiver}, not to the Rounds contract. Nothing here can be re-checked against a plan.`));
  return done(`Calls ${method} on ${receiver}`, { call });
}
