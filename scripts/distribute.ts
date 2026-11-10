// make distribute: demo step 10, run against the committed testnet demo (after `make demo`). The DAO treasury shares a $100,000 pot with
// everyone who holds shares, pro rata (RULES.md R10). The engine computes the plan from the CHAIN'S cap table; an officer proposes it as an
// exit plan; the DAO funds it from its own treasury and approves it by plan hash (two 2-of-3 votes each); anyone runs distribute.
// Testnet only, no value. It needs the demo accounts' keys in ~/.near-credentials, and runs once per demo deployment.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { canonicalJson, planHash, proRataDistribution, holderTotals, distributionPlan } from "../src/engine/index";
import { demoPlans, DISTRIBUTION_POT_MICRO, type Accounts } from "./plans";

const addr = JSON.parse(readFileSync("results/demo-addresses.json", "utf8"));
const A = addr.accounts as Accounts & { fund: string; indep: string; zed: string }, DAO = addr.dao as string, CORE = addr.rounds as string, USDC = addr.token as string;
const NET = "testnet", RPC = process.env.RPC_URL ?? "https://test.rpc.fastnear.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`[distribute] ${m}`);
const txs: { step: string; tx: string; what: string; signer?: string }[] = [];

async function rfetch(url: string, init: RequestInit): Promise<Response> {
  for (let i = 1; ; i++) { try { return await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }); } catch (e) { if (i >= 6) throw e; await sleep(1500 * i); } }
}
function near(args: string[]): string {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = spawnSync("near", args, { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
    const out = (r.stderr ?? "") + "\nprinted to stdout):\n" + (r.stdout ?? "");
    if (r.status === 0) return out;
    if (attempt === 3 || /ExecutionError|panicked|Smart contract panicked|wasm execution failed/i.test(out)) throw new Error(`near ${args.slice(0, 5).join(" ")} failed:\n${out.slice(-900)}`);
    log(`retry ${attempt}`);
  }
  throw new Error("unreachable");
}
const parseTx = (o: string) => o.match(/transactions\/([A-Za-z0-9]{40,50})/)?.[1] ?? "";
const parseRet = (o: string): any => {
  const clean = o.replace(/\x1b\[[0-9;]*m/g, ""); const k = clean.lastIndexOf("printed to stdout):"); if (k < 0) return undefined;
  const rest = clean.slice(k + "printed to stdout):".length).trim(); const m = rest.match(/^(\{[\s\S]*?\n\}|\[[\s\S]*?\n\]|"[^"\n]*"|[^\s]+)/);
  try { return m ? JSON.parse(m[1]) : undefined; } catch { return undefined; }
};
function call(what: string, contract: string, method: string, args: object | string, signer: string, opts: { deposit?: string; gas?: string } = {}) {
  const out = near(["contract", "call-function", "as-transaction", contract, method, "json-args", typeof args === "string" ? args : JSON.stringify(args), "prepaid-gas", opts.gas ?? "100 Tgas", "attached-deposit", opts.deposit ?? "0 NEAR", "sign-as", signer, "network-config", NET, "sign-with-legacy-keychain", "send"]);
  const tx = parseTx(out); txs.push({ step: "10", tx, what, signer }); log(`${what} ${tx.slice(0, 8)}`);
  return { tx, ret: parseRet(out) };
}
async function view(contract: string, method: string, args: object = {}) {
  const res = await rfetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }) });
  const j: any = await res.json(); if (j.error || j.result?.error) throw new Error(JSON.stringify(j.error ?? j.result.error));
  return JSON.parse(Buffer.from(j.result.result).toString());
}
const bal = async (who: string) => BigInt(await view(USDC, "ft_balance_of", { account_id: who }));

/** One DAO proposal executed by two council votes (fund + indep), as in the demo. */
async function dao(what: string, receiver: string, method: string, args: object, gas: string, deposit: string, voteGas: string) {
  const prop = { proposal: { description: what, kind: { FunctionCall: { receiver_id: receiver, actions: [{ method_name: method, args: Buffer.from(JSON.stringify(args)).toString("base64"), deposit, gas }] } } } };
  const pid = call(`DAO proposal: ${what}`, DAO, "add_proposal", prop, A.fund, { deposit: "0.1 NEAR" }).ret as number;
  call(`DAO vote 1/2 (fund) on #${pid}`, DAO, "act_proposal", { id: pid, action: "VoteApprove" }, A.fund);
  call(`DAO vote 2/2 (indep) on #${pid}: executes ${method}`, DAO, "act_proposal", { id: pid, action: "VoteApprove" }, A.indep, { gas: voteGas });
  const p = await view(DAO, "get_proposal", { id: pid });
  if (p.status !== "Approved") throw new Error(`proposal ${pid} is ${p.status}`);
}

async function main() {
  if ((await view(CORE, "exit", { exit_id: 2 })) !== null) throw new Error("exit 2 already exists on this deployment: the shared payout has been run once; run `make demo` for a fresh deployment");
  const held: Record<string, bigint> = {};
  for (let from = 0; ; from += 100) { const page: [string, string, string][] = await view(CORE, "cap_table", { from, limit: 100 }); for (const [h, c, s] of page) held[`${h}|${c}`] = BigInt(s); if (page.length < 100) break; }
  const d = proRataDistribution(holderTotals(held), DISTRIBUTION_POT_MICRO);
  const plan = canonicalJson(distributionPlan(d)), hash = await planHash(plan);
  const eng = demoPlans(A);
  if (plan !== eng.distributionPlan) throw new Error("the plan computed from the chain's cap table differs from the engine's expected plan");
  log(`cap table from the chain: ${d.eligibleShares} eligible shares; pot $${DISTRIBUTION_POT_MICRO / 1_000_000n}; ${d.payouts.length} payouts totalling ${d.paidMicro} micro-dollars; remainder ${d.remainderMicro} left in the treasury`);

  const holders = d.payouts.map(([h]) => h);
  const [pre, treasuryBefore] = [await Promise.all(holders.map(bal)), await bal(DAO)];
  const x = call("ada proposes the shared payout ($100,000 pro rata over all holders)", CORE, "propose_exit", { plan_hash: hash, plan_uri: "ipfs://shared-payout", plan }, A.ada).ret as number;
  if (x !== 2) throw new Error(`expected exit 2, got ${x}`);
  // the DAO pays the pot out of its own treasury: a FunctionCall proposal on the token, with the 1 yoctoNEAR a NEP-141 transfer requires
  await dao("board funds the shared payout from the treasury", USDC, "ft_transfer_call", { receiver_id: CORE, amount: d.paidMicro.toString(), msg: JSON.stringify({ action: "exit", id: x }) }, "120000000000000", "1", "300 Tgas");
  const e = await view(CORE, "exit", { exit_id: x });
  if (e.funded !== d.paidMicro.toString() || JSON.stringify(e.funders) !== JSON.stringify([[DAO, d.paidMicro.toString()]])) throw new Error(`the exit is not funded by the DAO treasury: ${JSON.stringify(e.funders)}`);
  if (treasuryBefore - await bal(DAO) !== d.paidMicro) throw new Error("the treasury did not pay exactly the plan total");
  log(`the treasury put ${d.paidMicro} into escrow (exit funders: the DAO)`);
  await dao("board approves the shared payout by plan hash", CORE, "approve_exit", { exit_id: x, plan_hash: hash }, "60000000000000", "0", "200 Tgas");
  call("anyone runs distribute", CORE, "distribute", { exit_id: x, from: 0, limit: Math.min(8, d.payouts.length) }, A.zed, { gas: "250 Tgas" });
  await sleep(10_000);
  const post = await Promise.all(holders.map(bal));
  d.payouts.forEach(([h, amt], i) => { if (post[i] - pre[i] !== amt) throw new Error(`payout ${h}: ${post[i] - pre[i]} != ${amt}`); log(`payout ${h} = ${Number(amt) / 1e6} (R10 ok)`); });
  const done = await view(CORE, "exit", { exit_id: x });
  if (!done.payouts.every((p: any) => p.state === "Paid")) throw new Error("not every payout is Paid");
  if (BigInt(await view(CORE, "ledger_total")) !== 0n) throw new Error("ledger not drained");
  log("every holder paid exactly once; ledger_total = 0");

  // append to the committed run: transactions, events (with the same collector as the demo), the plan
  const events: { name: string; tx: string; data: any }[] = [];
  for (const t of txs) {
    let res: any = null;
    for (let i = 1; i <= 6 && !res; i++) {
      try { const r: any = await (await rfetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "EXPERIMENTAL_tx_status", params: { tx_hash: t.tx, sender_account_id: t.signer, wait_until: "FINAL" } }) })).json(); if (r.result) res = r.result; else throw new Error(JSON.stringify(r.error).slice(0, 100)); }
      catch (err) { if (i === 6) throw new Error(`could not read tx ${t.tx}: ${(err as Error).message}`); await sleep(2000 * i); }
    }
    for (const ro of res.receipts_outcome ?? []) for (const l of ro.outcome.logs as string[]) { if (!l.startsWith("EVENT_JSON:")) continue; const ev = JSON.parse(l.slice(11)); if (ev.standard === "rounds") events.push({ name: ev.event, tx: t.tx, data: ev.data }); }
  }
  const rd = (f: string) => JSON.parse(readFileSync(f, "utf8"));
  writeFileSync("results/demo-txs.json", JSON.stringify([...rd("results/demo-txs.json"), ...txs], null, 2));
  const allEvents = [...rd("results/demo-events.json"), ...events];
  writeFileSync("results/demo-events.json", JSON.stringify(allEvents, null, 1)); writeFileSync("web/public/events.json", JSON.stringify(allEvents, null, 1));
  writeFileSync("results/demo-plans.json", JSON.stringify({ ...rd("results/demo-plans.json"), distribution: { id: x, plan } }, null, 2));
  log(`${txs.length} transactions and ${events.length} events appended`);
}
main().catch((e) => { console.error(e); process.exit(1); });
