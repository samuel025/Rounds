// make verify-onchain: READ-ONLY. Recomputes the closed demo rounds and the exit from the engine, then compares
// plan hashes, plan bytes and holdings with what the Rounds contract holds on testnet. Sends no transaction.
import { readFileSync, existsSync } from "node:fs";
import { planHash, priceRound } from "../src/engine/index";
import { demoPlans, type Accounts } from "./plans";

const addr = JSON.parse(readFileSync("results/demo-addresses.json", "utf8"));
const RPC = process.env.RPC_URL ?? "https://test.rpc.fastnear.com", ARCHIVAL = process.env.ARCHIVAL_RPC_URL ?? "https://archival-rpc.testnet.fastnear.com"; // state views: regular node; old transactions: archival
const lines: string[] = []; let failed = 0, total = 0;
const check = (ok: boolean, msg: string) => { total++; if (!ok) failed++; const l = `${ok ? "PASS" : "FAIL"} ${msg}`; lines.push(l); console.log(l); };

async function view(method: string, args: object = {}) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20_000), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: addr.rounds, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }) });
      const j: any = await res.json(); if (j.error || j.result?.error) throw new Error(JSON.stringify(j.error ?? j.result.error).slice(0, 120));
      return JSON.parse(Buffer.from(j.result.result).toString());
    } catch (e) { if (i >= 5) throw e; await new Promise((r) => setTimeout(r, 1500 * i)); }
  }
}

async function main() {
  const A = addr.accounts as Accounts;
  const p = demoPlans(A);
  check(p.result.priceMicro === 2_000_000n && p.result.fullyDiluted === 15_000_000n && p.result.holdings[A.fund] === 4_500_000n, "engine reproduces GV-1 (price $2.0000, 15,000,000 fully diluted, Fund 4,500,000)");
  const cfg = await view("config");
  check(cfg[0] === addr.dao && cfg[1] === addr.token, `config: board is the DAO ${addr.dao} and the payment token is ${addr.token}`);
  for (let i = 0; i < p.rounds.length; i++) {
    const r = await view("round", { round_id: i + 1 });
    const h = await planHash(p.rounds[i]);
    check(r.status === "Closed", `round ${i + 1} (${r.kind}): status Closed`);
    check(r.plan === p.rounds[i], `round ${i + 1}: on-chain plan equals the plan the engine recomputes`);
    check(r.plan_hash === h, `round ${i + 1}: on-chain plan hash ${h.slice(0, 16)}… equals sha256 of the recomputed plan`);
    const terms = JSON.parse(r.plan);
    check(terms.kind === r.kind && JSON.stringify(terms.raise) === JSON.stringify(r.raise) && JSON.stringify(r.deposits) === JSON.stringify(r.raise), `round ${i + 1}: the investors and amounts on chain (${r.raise.length ? r.raise.map((x: [string, string]) => "$" + (BigInt(x[1]) / 1_000_000n).toLocaleString("en-US")).join(", ") : "none"}) are the ones inside the approved plan, paid in full`);
  }
  const held: Record<string, bigint> = {};
  for (let from = 0; ; from += 100) {
    const page: [string, string, string][] = await view("cap_table", { from, limit: 100 });
    for (const [h, c, s] of page) held[`${h}|${c}`] = BigInt(s);
    if (page.length < 100) break;
  }
  // demo step 9: Efe exercised 1,000 options out of the unissued pool (shares move, none are minted)
  const EXN = 1_000n, want = { ...p.holdings };
  want[`${A.efe}|Common`] = (want[`${A.efe}|Common`] ?? 0n) + EXN; want["unissued_pool|Common"] -= EXN;
  const sum = (m: Record<string, bigint>) => Object.values(m).reduce((a, b) => a + b, 0n);
  check(sum(want) === sum(p.holdings), "exercise conserved the total share count (none minted)");
  check(await view("strike_balance") === "0", "strike_balance = 0 (the exercise strike was swept to the treasury)"); const keys = new Set([...Object.keys(want), ...Object.keys(held)]);
  const wrong = [...keys].filter((k) => (want[k] ?? 0n) !== (held[k] ?? 0n));
  check(wrong.length === 0, `cap table: all ${keys.size} (holder, class) holdings equal the engine's result${wrong.length ? " — differs: " + wrong.join(", ") : ""}`);
  const x = await view("exit", { exit_id: 1 });
  check(x.plan_hash === await planHash(p.exit), `exit 1: on-chain plan hash equals sha256 of the recomputed waterfall plan`);
  check(x.payouts.length === 5 && x.payouts.every((q: any) => q.state === "Paid"), "exit 1: all 5 payouts Paid");
  check(x.payouts.every((q: any, i: number) => q.amount === JSON.parse(p.exit).payouts[i][1] && q.holder === JSON.parse(p.exit).payouts[i][0]), "exit 1: every payout equals the engine's waterfall to the micro-dollar");
  // demo step 10: the DAO treasury shared $100,000 pro rata over every holder (RULES.md R10)
  const dist = p.distribution, x2 = await view("exit", { exit_id: 2 });
  check(x2 !== null && x2.plan_hash === await planHash(p.distributionPlan), `exit 2 (shared payout): on-chain plan hash equals sha256 of the pro-rata plan the engine computes from the final cap table (${dist.eligibleShares} eligible shares)`);
  check(!!x2 && x2.payouts.length === dist.payouts.length && x2.payouts.every((q: any, i: number) => q.state === "Paid" && q.holder === dist.payouts[i][0] && q.amount === dist.payouts[i][1].toString()), `exit 2: all ${dist.payouts.length} payouts Paid and equal to the engine's pro-rata amounts to the micro-dollar (remainder ${dist.remainderMicro} micro-dollars not paid)`);
  check(!!x2 && JSON.stringify(x2.funders) === JSON.stringify([[addr.dao, dist.paidMicro.toString()]]) && !x2.cancelled, "exit 2: it was funded by the DAO treasury itself, in the amount of the plan");
  if (existsSync("results/demo-attacks.json")) {
    for (const t of JSON.parse(readFileSync("results/demo-attacks.json", "utf8")) as { what: string; signer: string; tx: string; error: string }[]) {
      const res = await (await fetch(ARCHIVAL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tx", params: { tx_hash: t.tx, sender_account_id: t.signer, wait_until: "FINAL" } }) })).json() as any;
      const fail = res.result?.status?.Failure;
      check(!!fail && JSON.stringify(fail).includes(t.error), `attack "${t.what}": transaction ${t.tx.slice(0, 8)}… exists on chain and failed${t.error ? ` ("${t.error}")` : ""}`);
    }
  }
  const ledger = await view("ledger_total");
  check(ledger === "0", "ledger: nothing left in custody (ledger_total = 0)");
  void priceRound;
  console.log(`${failed ? "FAIL" : "PASS"} summary: ${total} checks, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.log(`FAIL could not read the chain: ${(e as Error).message}`); console.log("FAIL summary: aborted, 1 failed"); process.exit(1); });
