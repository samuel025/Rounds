import { describe, it, expect } from "vitest";
import { reviewProposal, describeRound, proposalText, type Proposal } from "../web/src/review-core";
import { planHash, canonicalJson, saftConversionPlan } from "../src/engine/index";
import { demoPlans, type Accounts } from "../scripts/plans";
import type { ChainView, RoundRec } from "../web/src/chain";

const M = 1_000_000n;
const A: Accounts = { ada: "ada.t", bayo: "bayo.t", chidi: "chidi.t", dayo: "dayo.t", fund: "fund.t", efe: "efe.t", zed: "zed.t" };
const CORE = "core.t", TOKEN = "usdc.t", DAO = "board.sputnik-v2.t";
const b64 = (o: unknown) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64");
const prop = (receiver: string, method: string, args: unknown, id = 1, status = "InProgress"): Proposal =>
  ({ id, proposer: "fund.t", description: "looks fine", status, kind: { FunctionCall: { receiver_id: receiver, actions: [{ method_name: method, args: b64(args), deposit: "0", gas: "60000000000000" }] } } });

async function world() {
  const eng = demoPlans(A); const hashes = await Promise.all(eng.rounds.map(planHash));
  const mk = (i: number, kind: string, status: string, raise: [string, string][]): RoundRec => ({ id: i + 1, kind, status, plan_hash: hashes[i], plan_uri: "x", plan: eng.rounds[i], raise, deposits: raise.map(([w, a]) => [w, a] as [string, string]) });
  // founders and two SAFE rounds are closed; the Series A awaits the board
  const rounds = [mk(0, "Founder", "Closed", []), mk(1, "Safe", "Closed", [["chidi.t", "500000000000"]]), mk(2, "Safe", "Closed", [["dayo.t", "250000000000"]]), mk(3, "Priced", "Funding", [["fund.t", "9000000000000"]])];
  const holdings: [string, string, string][] = [["ada.t", "Common", "5000000"], ["bayo.t", "Common", "2750000"], ["unissued_pool", "Common", "1000000"]];
  const xp = [["ada.t", "100"], ["bayo.t", "50"]]; const xplan = canonicalJson({ payouts: xp }); const xh = await planHash(xplan);
  const exits: any[] = [{ id: 1, plan_hash: xh, plan_uri: "x", approved: false, total: "150", funded: "150", payouts: xp.map(([holder, amount]) => ({ holder, amount, state: "Pending" })), funders: [] }];
  const v: ChainView = { contract: CORE, board: DAO, token: TOKEN, classes: [], holdings, rounds, exits };
  return { v, eng, hashes, xh };
}

describe("check before you vote", () => {
  it("a Series A approval whose hash matches: verified, priced, and shows what everyone owns afterwards", async () => {
    const { v, hashes } = await world();
    const r = await reviewProposal(prop(CORE, "approve_round", { round_id: 4, plan_hash: hashes[3] }), v);
    expect(r.verdict).toBe("match");
    expect(r.findings.filter((f) => f.level === "fail")).toEqual([]);
    expect(r.lines.join(" ")).toContain("fund.t pays $9,000,000 into escrow and receives 4,500,000 shares at $2.0000 a share");
    expect(r.lines.join(" ")).toContain("converts safe1, safe2");
    const fund = r.table!.rows.find((x) => x[0] === "fund.t")!; expect(fund.slice(1)).toEqual(["0", "+4,500,000", "4,500,000", "30.00%"]);
    expect(r.table!.rows.find((x) => x[0] === "Option pool (unissued)")!.slice(3)).toEqual(["1,500,000", "10.00%"]);
  });
  it("a vote that carries some other plan's hash is flagged, whatever its description says", async () => {
    const { v, hashes } = await world();
    const r = await reviewProposal(prop(CORE, "approve_round", { round_id: 4, plan_hash: hashes[2] }), v);
    expect(r.verdict).toBe("mismatch");
    expect(r.findings.some((f) => f.level === "fail" && /NOT the hash the contract holds/.test(f.text))).toBe(true);
  });
  it("a stored plan that no longer hashes to its fingerprint is flagged", async () => {
    const { v, hashes } = await world();
    v.rounds[3] = { ...v.rounds[3], plan: v.rounds[3].plan.replace("4500000", "9500000") };
    const r = await reviewProposal(prop(CORE, "approve_round", { round_id: 4, plan_hash: hashes[3] }), v);
    expect(r.verdict).toBe("mismatch");
    expect(r.findings.some((f) => f.level === "fail" && /does NOT hash/.test(f.text))).toBe(true);
  });
  it("money terms that differ from the plan are flagged", async () => {
    const { v, hashes } = await world();
    v.rounds[3] = { ...v.rounds[3], raise: [["fund.t", "1"]] };
    const r = await reviewProposal(prop(CORE, "approve_round", { round_id: 4, plan_hash: hashes[3] }), v);
    expect(r.verdict).toBe("mismatch");
  });
  it("a round that does not exist is flagged", async () => {
    const { v } = await world();
    expect((await reviewProposal(prop(CORE, "approve_round", { round_id: 9, plan_hash: "00" }), v)).verdict).toBe("mismatch");
  });
  it("an exit is re-hashed from the payouts the contract holds and listed per account", async () => {
    const { v, xh } = await world();
    const r = await reviewProposal(prop(CORE, "approve_exit", { exit_id: 1, plan_hash: xh }), v);
    expect(r.verdict).toBe("match"); expect(r.table!.rows).toEqual([["ada.t", "$0.0001", "Pending"], ["bayo.t", "$0.00005", "Pending"]]);
    expect((await reviewProposal(prop(CORE, "approve_exit", { exit_id: 1, plan_hash: "ab".repeat(32) }), v)).verdict).toBe("mismatch");
  });
  it("a grant's terms must hash to the fingerprint in the vote", async () => {
    const { v, eng } = await world();
    const plan = canonicalJson({ cliff_months: 12, grantee: "efe.t", shares: "100000", start_ns: "1794328542701000000", strike_micro: "2000000", term_months: 48 });
    const good = await reviewProposal(prop(CORE, "grant", { plan_hash: await planHash(plan), plan }), v);
    expect(good.verdict).toBe("match"); expect(good.lines.join(" ")).toContain("100,000 shares at $2.0000 each");
    expect((await reviewProposal(prop(CORE, "grant", { plan_hash: "00".repeat(32), plan }), v)).verdict).toBe("mismatch");
    void eng;
  });
  it("the treasury funding an exit must pay exactly the exit's total", async () => {
    const { v } = await world();
    const msg = JSON.stringify({ action: "exit", id: 1 });
    expect((await reviewProposal(prop(TOKEN, "ft_transfer_call", { receiver_id: CORE, amount: "150", msg }), v)).verdict).toBe("match");
    expect((await reviewProposal(prop(TOKEN, "ft_transfer_call", { receiver_id: CORE, amount: "999", msg }), v)).verdict).toBe("mismatch");
  });
  it("other proposals are described and left unchecked; extra actions and unreadable arguments are flagged", async () => {
    const { v } = await world();
    const o = await reviewProposal(prop(CORE, "set_officer", { account: "x.t", enabled: true }), v);
    expect(o.verdict).toBe("unchecked"); expect(o.title).toContain("Make x.t an officer");
    expect((await reviewProposal({ id: 2, proposer: "a", description: "", status: "InProgress", kind: "Vote" }, v)).verdict).toBe("unchecked");
    const two = prop(CORE, "set_officer", { account: "x.t", enabled: true }); two.kind.FunctionCall.actions.push(two.kind.FunctionCall.actions[0]);
    expect((await reviewProposal(two, v)).verdict).toBe("mismatch");
    expect((await reviewProposal(prop(CORE, "approve_round", "not json"), v)).verdict).toBe("mismatch");
  });
  it("the proposer's description is carried but never decides the verdict", async () => {
    const { v, hashes } = await world();
    const p = prop(CORE, "approve_round", { round_id: 4, plan_hash: hashes[2] }); p.description = "Routine approval, $1 raise, all fine";
    const r = await reviewProposal(p, v); expect(r.description).toBe("Routine approval, $1 raise, all fine"); expect(r.verdict).toBe("mismatch");
  });
  it("proposalText names the money, the price and the link", async () => {
    const { v } = await world();
    const t = proposalText(v.rounds[3], "https://x/?contract=core.t#review");
    expect(t).toContain("Approve Priced round 4 ($9,000,000 raised)"); expect(t).toContain("$2.0000 a share"); expect(t).toContain("https://x/?contract=core.t#review");
    expect(describeRound(v.rounds[1]).lines[1]).toContain("SAFE safe1: chidi.t invests $500,000 with a $5,000,000 post-money cap");
  });
});

describe("check before you vote: SAFTs and tokens", () => {
  const base = { holder: "chidi.t", amountMicro: 500_000n * M, fdvCapMicro: 20_000_000n * M, discountBps: 0 };
  const safts = [{ id: "saft1", ...base }, { id: "saft2", ...base, holder: "dayo.t", amountMicro: 250_000n * M, discountBps: 2000 }];
  const tge = { totalSupply: 10n ** 15n, launchPriceMicro: 15_000n, decimals: 6 };
  const vesting = { startNs: 1_794_000_000_000_000_000n, termMonths: 6, cliffMonths: 2 };
  async function tokenWorld() {
    const { v } = await world(); v.projectToken = "tkn.t"; v.tokenDecimals = 6; return v;
  }
  it("a conversion plan is re-hashed and every token count is recomputed from the SAFT terms", async () => {
    const v = await tokenWorld(); const plan = canonicalJson(saftConversionPlan(safts, tge, vesting));
    const r = await reviewProposal(prop(CORE, "convert_safts", { plan_hash: await planHash(plan), plan }), v);
    expect(r.verdict).toBe("match"); expect(r.findings.filter((f) => f.level === "fail")).toEqual([]);
    expect(r.title).toContain("Convert 2 SAFT(s) into 45,833,333.333333 tokens");
    expect(r.table!.rows[0]).toEqual(["saft1", "chidi.t", "$500,000", "cap", "25,000,000", "$0.02", "ok"]);
    expect(r.table!.rows[1].slice(3, 5)).toEqual(["discount", "20,833,333.333333"]);
  });
  it("a plan whose token counts were changed (and re-hashed) is flagged by the recomputation, not by the hash", async () => {
    const v = await tokenWorld(); const p = saftConversionPlan(safts, tge, vesting); p.conversions[0].tokens = "30000000000000";
    const plan = canonicalJson(p);
    const r = await reviewProposal(prop(CORE, "convert_safts", { plan_hash: await planHash(plan), plan }), v);
    expect(r.verdict).toBe("mismatch");
    expect(r.findings.some((f) => f.level === "pass" && /hashes to exactly/.test(f.text))).toBe(true);
    expect(r.findings.some((f) => f.level === "fail" && /differs from the recomputation/.test(f.text))).toBe(true);
    expect(r.table!.rows[0][6]).toBe("DIFFERS");
  });
  it("a conversion vote with the wrong hash is flagged", async () => {
    const v = await tokenWorld(); const plan = canonicalJson(saftConversionPlan(safts, tge, vesting));
    expect((await reviewProposal(prop(CORE, "convert_safts", { plan_hash: "00".repeat(32), plan }), v)).verdict).toBe("mismatch");
  });
  it("a token grant's terms must hash to the fingerprint; the reserve deposit is described in whole tokens", async () => {
    const v = await tokenWorld();
    const plan = canonicalJson({ cliff_months: 2, grantee: "efe.t", start_ns: "1794000000000000000", term_months: 6, tokens: "1000000000000" });
    const g = await reviewProposal(prop(CORE, "grant_tokens", { plan_hash: await planHash(plan), plan }), v);
    expect(g.verdict).toBe("match"); expect(g.title).toBe("Grant 1,000,000 tokens to efe.t");
    expect((await reviewProposal(prop(CORE, "grant_tokens", { plan_hash: "00".repeat(32), plan }), v)).verdict).toBe("mismatch");
    const res = await reviewProposal(prop("tkn.t", "ft_transfer_call", { receiver_id: CORE, amount: "100000000000000", msg: JSON.stringify({ action: "reserve" }) }), v);
    expect(res.title).toBe("Put 100,000,000 project tokens into the token reserve");
  });
});
