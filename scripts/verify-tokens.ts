// make verify-tokens: READ-ONLY. Recomputes the SAFT / project-token demo (`make tokens`) from the engine and compares it with the second
// Rounds contract on testnet: the Saft round, the token grants the contract created, the DAO proposals that carried the plan hashes,
// the token balances, the reserve, and the failed attack. Sends no transaction.
import { readFileSync, existsSync } from "node:fs";
import { planHash, canonicalJson, convertSafts, saftConversionPlan, unlockedTokens, type Saft } from "../src/engine/index";

if (!existsSync("results/tokens-addresses.json")) { console.log("FAIL results/tokens-addresses.json is missing: run `make tokens` first"); console.log("FAIL summary: aborted, 1 failed"); process.exit(1); }
const addr = JSON.parse(readFileSync("results/tokens-addresses.json", "utf8")), plans = JSON.parse(readFileSync("results/tokens-plans.json", "utf8"));
const RPC = process.env.RPC_URL ?? "https://test.rpc.fastnear.com", ARCHIVAL = process.env.ARCHIVAL_RPC_URL ?? "https://archival-rpc.testnet.fastnear.com";
const A = addr.accounts as Record<string, string>, M = 1_000_000n, DEC = addr.decimals as number;
let failed = 0, total = 0;
const check = (ok: boolean, msg: string) => { total++; if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };
async function view(contract: string, method: string, args: object = {}) {
  for (let i = 1; ; i++) {
    try {
      const j: any = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20_000), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }) })).json();
      if (j.error || j.result?.error) throw new Error(JSON.stringify(j.error ?? j.result.error).slice(0, 120));
      return JSON.parse(Buffer.from(j.result.result).toString());
    } catch (e) { if (i >= 5) throw e; await new Promise((r) => setTimeout(r, 1500 * i)); }
  }
}
const bal = async (who: string) => BigInt(await view(addr.token, "ft_balance_of", { account_id: who }));

async function main() {
  const core = addr.rounds as string;
  const cfg = await view(core, "config"), info = await view(core, "token_info");
  check(cfg[0] === addr.dao && cfg[1] === addr.payment_token, `config: the board is the demo DAO ${addr.dao} and the payment token is the demo USDC`);
  check(info[0] === addr.token && info[1] === DEC, `the project token is ${addr.token} with ${DEC} decimals, named once by the board`);
  // the Saft round
  const rd = await view(core, "round", { round_id: plans.round.id }), body = JSON.parse(plans.round.plan);
  check(rd.status === "Closed" && rd.kind === "Saft", "the Saft round is Closed");
  check(rd.plan === plans.round.plan && rd.plan_hash === await planHash(plans.round.plan), "the plan on chain equals the committed plan, and its hash equals sha256 of it");
  check(JSON.stringify(body.raise) === JSON.stringify(rd.raise) && JSON.stringify(rd.deposits) === JSON.stringify(rd.raise), `the investors and amounts on chain are the ones inside the approved plan, paid in full (${rd.raise.map((x: [string, string]) => "$" + (BigInt(x[1]) / M).toLocaleString("en-US")).join(", ")})`);
  const safts: Saft[] = body.safts.map((s: any) => ({ id: s.id, holder: s.holder, amountMicro: BigInt(s.amount), fdvCapMicro: BigInt(s.fdv_cap), discountBps: s.discount_bps }));
  for (const s of safts) { const c = await view(core, "saft", { id: s.id }); check(c && c.converted === true && c.amount === s.amountMicro.toString() && c.fdv_cap === s.fdvCapMicro.toString() && c.discount_bps === s.discountBps, `SAFT ${s.id}: the contract holds the terms of the plan and has converted it`); }
  // the conversion, recomputed by the engine
  const conv = JSON.parse(plans.conversion.plan), tge = { totalSupply: BigInt(conv.tge.total_supply), launchPriceMicro: BigInt(conv.tge.launch_price_micro), decimals: conv.tge.decimals };
  const eng = convertSafts(safts, tge);
  const vesting = { startNs: BigInt(conv.vesting.start_ns), termMonths: conv.vesting.term_months, cliffMonths: conv.vesting.cliff_months };
  check(canonicalJson(saftConversionPlan(safts, tge, vesting)) === plans.conversion.plan, "the committed conversion plan equals the plan the engine computes from the SAFT terms and the launch inputs");
  const grants = await Promise.all([1, 2, 3].map((id) => view(core, "token_grant", { grant_id: id })));
  eng.results.forEach((r, i) => check(grants[i].grantee === r.holder && grants[i].tokens === r.tokens.toString() && grants[i].saft_id === r.id, `token grant ${i + 1}: ${r.holder} holds ${r.tokens} units from ${r.id} (${r.regime} price), equal to the engine and to what the contract computed itself`));
  const g3 = JSON.parse(plans.grant.plan);
  check(grants[2].grantee === g3.grantee && grants[2].tokens === g3.tokens && grants[2].saft_id === null && grants.every((g) => g.term_months === 6 && g.cliff_months === 2), "token grant 3: the contributor's tokens equal the board-approved grant, and all three follow the same 6-month schedule with a 2-month cliff");
  check(grants.every((g, i) => g.claimed === g.tokens && BigInt(g.tokens) === unlockedTokens(BigInt(g.tokens), { termMonths: 6, cliffMonths: 2 }, 6) && i >= 0), "every grant is fully vested at the end of its term and has been claimed in full");
  // the DAO proposals that carried the hashes
  const last = await view(addr.dao, "get_last_proposal_id"), props: any[] = await view(addr.dao, "get_proposals", { from_index: Math.max(0, last - 60), limit: 60 });
  const find = (m: string) => props.filter((p) => p.kind?.FunctionCall?.actions?.[0]?.method_name === m && p.kind.FunctionCall.receiver_id === core).map((p) => ({ p, a: JSON.parse(Buffer.from(p.kind.FunctionCall.actions[0].args, "base64").toString()) })).pop();
  const pc = find("convert_safts"), pg = find("grant_tokens");
  check(!!pc && pc.p.status === "Approved" && pc.a.plan === plans.conversion.plan && pc.a.plan_hash === plans.conversion.hash && pc.a.plan_hash === await planHash(plans.conversion.plan), "the DAO's convert_safts proposal is Approved and carries exactly the committed plan and its hash");
  check(!!pg && pg.p.status === "Approved" && pg.a.plan === plans.grant.plan && pg.a.plan_hash === await planHash(plans.grant.plan), "the DAO's grant_tokens proposal is Approved and carries exactly the committed grant and its hash");
  // balances and the reserve
  const want: [string, bigint][] = [[A.chidi, BigInt(eng.results[0].tokens)], [A.dayo, BigInt(eng.results[1].tokens)], [A.efe, BigInt(g3.tokens)]];
  const got = await Promise.all(want.map(([w]) => bal(w)));
  check(got.every((g, i) => g === want[i][1]), `token balances equal the engine: ${want.map(([w], i) => `${w.replace(/^rounds-|-\d+\.testnet$/g, "")} ${got[i]}`).join(", ")}`);
  const claimed = want.reduce((a, [, t]) => a + t, 0n), reserve = 100_000_000n * 10n ** BigInt(DEC);
  check(BigInt(info[2]) === reserve - claimed && BigInt(info[3]) === 0n && BigInt(info[4]) === 0n, `reserve accounting: ${reserve} funded by the DAO, ${claimed} paid out, ${info[2]} left, nothing in flight, no open claims`);
  check(await view(core, "ledger_total") === "0", "ledger: the SAFT escrow was forwarded to the treasury, nothing is left in custody (ledger_total = 0)");
  for (const t of existsSync("results/tokens-attacks.json") ? JSON.parse(readFileSync("results/tokens-attacks.json", "utf8")) as { what: string; signer: string; tx: string; error: string }[] : []) {
    const res = await (await fetch(ARCHIVAL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tx", params: { tx_hash: t.tx, sender_account_id: t.signer, wait_until: "FINAL" } }) })).json() as any;
    const fail = res.result?.status?.Failure;
    check(!!fail && JSON.stringify(fail).includes(t.error), `attack "${t.what}": transaction ${t.tx.slice(0, 8)}… exists on chain and failed ("${t.error}")`);
  }
  console.log(`${failed ? "FAIL" : "PASS"} summary: ${total} checks, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.log(`FAIL could not read the chain: ${(e as Error).message}`); console.log("FAIL summary: aborted, 1 failed"); process.exit(1); });
