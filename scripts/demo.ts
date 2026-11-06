// make demo: scripted testnet run (see PRD section 11). Testnet only; token has no value.
// Every plan below is produced by the engine; the contract only credits plans the board approved by hash.
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { priceRound, waterfall, vested, canonicalJson, planHash, pricedRoundPlan } from "../src/engine/index";

const NET = "testnet", RPC = "https://rpc.testnet.near.org", EXPLORER = "https://explorer.testnet.near.org";
const M = 1_000_000n;
const S = process.env.DEMO_SUFFIX ?? String(Date.now()).slice(-6);
const id = (n: string) => `rounds-${n}-${S}.testnet`;
const A = { ada: id("ada"), fund: id("fund"), indep: id("indep"), bayo: id("bayo"), chidi: id("chidi"), dayo: id("dayo"), efe: id("efe"), zed: id("zed"), core: id("core"), usdc: id("usdc"), fake: id("fake") };
const DAO = `rounds-board-${S}.sputnik-v2.testnet`;
const MONTH_NS = 5_000_000_000n, WINDOW_NS = 15_000_000_000n; // demo clock: one "month" = 5 s

async function rfetch(url: string, init: RequestInit): Promise<Response> {
  for (let i = 1; ; i++) { try { return await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }); } catch (e) { if (i >= 6) throw e; await new Promise((r) => setTimeout(r, 1500 * i)); } }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`[demo] ${m}`);
const txs: { step: string; tx: string; what: string; signer?: string }[] = [];
const events: { name: string; tx: string; data: any; plan?: string }[] = [];
const planByRound: Record<string, string> = {};

function near(args: string[]): string {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = spawnSync("near", args, { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
    const out = (r.stderr ?? "") + "\nprinted to stdout):\n" + (r.stdout ?? ""); // the CLI prints the return value on stdout, its label on stderr
    if (r.status === 0) return out;
    if (attempt === 3 || /ExecutionError|panicked|Smart contract panicked|wasm execution failed/i.test(out)) throw new Error(`near ${args.slice(0, 5).join(" ")} failed:\n${out.slice(-900)}`);
    log(`retry ${attempt} after: ${out.slice(-160).replace(/\n/g, " ")}`);
  }
  throw new Error("unreachable");
}
const parseTx = (o: string) => o.match(/transactions\/([A-Za-z0-9]{40,50})/)?.[1] ?? "";
const parseRet = (o: string): any => {
  const clean = o.replace(/\x1b\[[0-9;]*m/g, ""); const k = clean.lastIndexOf("printed to stdout):"); if (k < 0) return undefined;
  const rest = clean.slice(k + "printed to stdout):".length).trim(); const m = rest.match(/^(\{[\s\S]*?\n\}|\[[\s\S]*?\n\]|"[^"\n]*"|[^\s]+)/);
  try { return m ? JSON.parse(m[1]) : undefined; } catch { return undefined; }
};
function sendRaw(contract: string, method: string, args: object | string, signer: string, opts: { deposit?: string; gas?: string } = {}) {
  return near(["contract", "call-function", "as-transaction", contract, method, "json-args", typeof args === "string" ? args : JSON.stringify(args), "prepaid-gas", opts.gas ?? "100 Tgas", "attached-deposit", opts.deposit ?? "0 NEAR", "sign-as", signer, "network-config", NET, "sign-with-legacy-keychain", "send"]);
}
function call(step: string, what: string, contract: string, method: string, args: object | string, signer: string, opts: { deposit?: string; gas?: string } = {}) {
  const out = sendRaw(contract, method, args, signer, opts);
  const tx = parseTx(out); txs.push({ step, tx, what, signer }); log(`${step} ${what} ${tx.slice(0, 8)}`);
  return { out, tx, ret: parseRet(out) };
}
async function view(contract: string, method: string, args: object = {}) {
  const res = await rfetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }) });
  const j: any = await res.json(); if (j.error || j.result?.error) throw new Error(JSON.stringify(j.error ?? j.result.error));
  return JSON.parse(Buffer.from(j.result.result).toString());
}
const bal = async (who: string, token = A.usdc) => BigInt(await view(token, "ft_balance_of", { account_id: who }));
const ft = (who: string, to: string, amount: bigint, msg: object, step: string, what: string, token = A.usdc) =>
  call(step, what, token, "ft_transfer_call", { receiver_id: to, amount: amount.toString(), msg: JSON.stringify(msg) }, who, { deposit: "1 yoctoNEAR", gas: "200 Tgas" });
const sha = planHash;

async function dao(step: string, what: string, receiver: string, method: string, args: object) {
  const a64 = Buffer.from(JSON.stringify(args)).toString("base64");
  const prop = { proposal: { description: what, kind: { FunctionCall: { receiver_id: receiver, actions: [{ method_name: method, args: a64, deposit: "0", gas: "60000000000000" }] } } } };
  const added = call(step, `DAO proposal: ${what}`, DAO, "add_proposal", prop, A.fund, { deposit: "0.1 NEAR" });
  const pid = added.ret as number;
  call(step, `DAO vote 1/2 (fund) on #${pid}`, DAO, "act_proposal", { id: pid, action: "VoteApprove" }, A.fund);
  const done = call(step, `DAO vote 2/2 (indep) on #${pid}: executes ${method}`, DAO, "act_proposal", { id: pid, action: "VoteApprove" }, A.indep, { gas: "200 Tgas" });
  const p = await view(DAO, "get_proposal", { id: pid });
  if (p.status !== "Approved") throw new Error(`proposal ${pid} is ${p.status}`);
  return done;
}
async function collectEvents() {
  for (const t of txs) {
    if (!t.tx || !t.signer) continue;
    const res: any = await rfetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "EXPERIMENTAL_tx_status", params: { tx_hash: t.tx, sender_account_id: t.signer, wait_until: "FINAL" } }) }).then((r) => r.json()).catch(() => null);
    for (const ro of res?.result?.receipts_outcome ?? []) for (const l of ro.outcome.logs as string[]) {
      if (!l.startsWith("EVENT_JSON:")) continue;
      const e = JSON.parse(l.slice(11)); if (e.standard !== "rounds") continue;
      events.push({ name: e.event, tx: t.tx, data: e.data, plan: e.event === "round_proposed" ? planByRound[String(e.data.round_id)] : undefined });
    }
  }
}
const expectFail = (label: string, fn: () => unknown) => { try { fn(); } catch { log(`ATTACK FAILED AS EXPECTED: ${label}`); return true; } throw new Error(`attack unexpectedly succeeded: ${label}`); };

async function main() {
  log(`suffix ${S}`);
  // ---- step 1: accounts, token, DAO, contract
  const exists = async (a: string) => { const r: any = await rfetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: a } }) }).then((x) => x.json()); return !r.error && !r.result?.error; };
  // faucet first (10 NEAR each); if it rate-limits, a funded earlier account pays for the rest
  const fallback: Record<string, [string, string]> = { zed: [A.chidi, "1.5 NEAR"], core: [A.bayo, "4.5 NEAR"], usdc: [A.efe, "3.5 NEAR"], fake: [A.dayo, "3 NEAR"] };
  for (const [k, a] of Object.entries(A)) {
    if (await exists(a)) { log(`exists ${k}: ${a}`); continue; }
    try { near(["account", "create-account", "sponsor-by-faucet-service", a, "autogenerate-new-keypair", "save-to-legacy-keychain", "network-config", NET, "create"]); }
    catch (e) {
      const fb = fallback[k]; if (!fb) throw e;
      log(`faucet refused ${k}; ${fb[0]} funds it with ${fb[1]}`);
      near(["account", "create-account", "fund-myself", a, fb[1], "autogenerate-new-keypair", "save-to-legacy-keychain", "sign-as", fb[0], "network-config", NET, "sign-with-legacy-keychain", "send"]);
    }
    log(`created ${k}: ${a}`);
  }
  const council = [A.ada, A.fund, A.indep];
  const cfg = { config: { name: `rounds-board-${S}`, purpose: "Rounds demo board", metadata: "" }, policy: { roles: [{ name: "council", kind: { Group: council }, permissions: ["*:AddProposal", "*:VoteApprove", "*:VoteReject", "*:VoteRemove", "*:Finalize"], vote_policy: {} }], default_vote_policy: { weight_kind: "RoleWeight", quorum: "0", threshold: [1, 2] }, proposal_bond: "100000000000000000000000", proposal_period: "604800000000000", bounty_bond: "100000000000000000000000", bounty_forgiveness_period: "86400000000000" } };
  if (await exists(DAO)) log(`exists DAO ${DAO}`); else call("1", "create the DAO board (2-of-3 council)", "sputnik-v2.testnet", "create", { name: `rounds-board-${S}`, args: Buffer.from(JSON.stringify(cfg)).toString("base64") }, A.ada, { gas: "150 Tgas", deposit: "6 NEAR" });
  const hasCode = async (a: string) => { const r: any = await rfetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: a } }) }).then((x) => x.json()); return r.result?.code_hash !== "11111111111111111111111111111111"; };
  const deploy = async (acct: string, wasm: string, init: string, args: object, step: string, what: string) => {
    if (await hasCode(acct)) { log(`already deployed ${acct}`); return; }
    const out = near(["contract", "deploy", acct, "use-file", wasm, "with-init-call", init, "json-args", JSON.stringify(args), "prepaid-gas", "50 Tgas", "attached-deposit", "0 NEAR", "network-config", NET, "sign-with-legacy-keychain", "send"]);
    txs.push({ step, tx: parseTx(out), what, signer: acct }); log(`${step} ${what}`);
  };
  await deploy(A.usdc, "contract/mock-ft/target/near/mock_ft.wasm", "new", { faucet_cap: (100_000_000n * M).toString() }, "1", "deploy test USDC (6 decimals, public faucet, no value)");
  await deploy(A.fake, "contract/mock-ft/target/near/mock_ft.wasm", "new", { faucet_cap: (1_000_000n * M).toString() }, "1", "deploy a second token used only for the wrong-token attack");
  const classes = ["Common", "Series A Preferred", "SAFE 1 shadow preferred", "SAFE 2 shadow preferred"].map((c) => ({ id: c, authorized: "100000000" }));
  await deploy(A.core, "contract/target/near/rounds.wasm", "new", { board: DAO, payment_token: A.usdc, classes, month_ns: Number(MONTH_NS), exercise_window_ns: Number(WINDOW_NS) }, "1", "deploy Rounds with the DAO as board");
  for (const a of [A.ada, A.fund, A.indep, A.bayo, A.chidi, A.dayo, A.efe, A.zed, A.core, DAO]) call("1", `register ${a} for test USDC`, A.usdc, "storage_deposit", { account_id: a }, A.ada);
  for (const a of [A.chidi, A.core]) call("1", `register ${a} for the fake token`, A.fake, "storage_deposit", { account_id: a }, A.ada);
  call("1", "faucet: fund $9,000,000 test USDC", A.usdc, "faucet", { account_id: A.fund, amount: (9_000_000n * M).toString() }, A.ada);
  call("1", "faucet: chidi $500,000", A.usdc, "faucet", { account_id: A.chidi, amount: (500_000n * M).toString() }, A.ada);
  call("1", "faucet: dayo $250,000", A.usdc, "faucet", { account_id: A.dayo, amount: (250_000n * M).toString() }, A.ada);
  call("1", "faucet: zed $20,000,000", A.usdc, "faucet", { account_id: A.zed, amount: (20_000_000n * M).toString() }, A.ada);
  call("1", "faucet: 100 fake tokens to chidi", A.fake, "faucet", { account_id: A.chidi, amount: (100n * M).toString() }, A.ada);
  await dao("1", "board makes ada an officer", A.core, "set_officer", { account: A.ada, enabled: true });

  const propose = async (step: string, kind: string, plan: object, raise: [string, bigint][], uri: string) => {
    const canon = canonicalJson(plan); const hash = await sha(canon);
    const r = call(step, `ada proposes ${kind} round`, A.core, "propose_round", JSON.stringify({ kind, plan_hash: hash, plan_uri: uri, plan: canon, raise: raise.map(([a, v]) => [a, v.toString()]), deadline_ns: "__MAX_U64__" }).replace('"__MAX_U64__"', "18446744073709551615"), A.ada);
    planByRound[String(r.ret)] = canon; return { rid: r.ret as number, canon, hash };
  };
  const approveClose = async (step: string, rid: number, hash: string, label: string) => {
    await dao(step, `board approves ${label} by plan hash`, A.core, "approve_round", { round_id: rid, plan_hash: hash });
    call(step, `anyone closes ${label}`, A.core, "close_round", { round_id: rid }, A.zed, { gas: "100 Tgas" });
  };
  const holding = async (h: string, c: string): Promise<bigint> => { const v: [string, string][] = await view(A.core, "holdings_of", { holder: h }); return BigInt(v.find((x) => x[0] === c)?.[1] ?? "0"); };

  // ---- step 2: founders and pool
  const founders = { issuances: [{ class: "Common", holder: A.ada, shares: "5000000" }, { class: "Common", holder: A.bayo, shares: "2750000" }, { class: "Common", holder: "unissued_pool", shares: "1000000" }] };
  const f = await propose("2", "Founder", founders, [], "ipfs://founders"); await approveClose("2", f.rid, f.hash, "founder issuance");

  // ---- step 3: SAFEs
  const safeSpec = [{ id: "safe1", holder: A.chidi, amt: 500_000n, cap: 5_000_000n, cls: "SAFE 1 shadow preferred" }, { id: "safe2", holder: A.dayo, amt: 250_000n, cap: 10_000_000n, cls: "SAFE 2 shadow preferred" }];
  for (const s of safeSpec) {
    const p = await propose("3", "Safe", { safes: [{ id: s.id, holder: s.holder, amount: (s.amt * M).toString(), post_money_cap: (s.cap * M).toString(), discount_bps: 0, converted: false }] }, [[s.holder, s.amt * M]], `ipfs://${s.id}`);
    await ft(s.holder, A.core, s.amt * M, { action: "round", id: p.rid }, "3", `${s.id} holder pays $${s.amt} into escrow`);
    await approveClose("3", p.rid, p.hash, s.id);
  }

  // ---- step 4-5: Series A from the engine (GV-1)
  const input = { common: { [A.ada]: 5_000_000n, [A.bayo]: 2_750_000n }, unissuedPool: 1_000_000n,
    safes: safeSpec.map((s) => ({ id: s.id, holder: s.holder, amount: s.amt * M, postMoneyCap: s.cap * M, discountBps: 0 })),
    preMoney: 21_000_000n * M, investors: { [A.fund]: 9_000_000n * M }, poolTarget: { num: 1n, den: 10n } };
  const res = priceRound(input);
  if (res.priceMicro !== 2_000_000n || res.fullyDiluted !== 15_000_000n) throw new Error("engine disagrees with GV-1");
  const clsOf = (sid: string) => safeSpec.find((s) => s.id === sid)!.cls;
  const aPlan = pricedRoundPlan(input, res, { safeClass: clsOf, seriesClass: "Series A Preferred" });
  const a = await propose("4", "Priced", aPlan, [[A.fund, 9_000_000n * M]], "ipfs://series-a");
  await ft(A.fund, A.core, 9_000_000n * M, { action: "round", id: a.rid }, "5", "fund pays $9,000,000 into escrow");
  await approveClose("5", a.rid, a.hash, "Series A");
  const rd = await view(A.core, "round", { round_id: a.rid });
  log(`Series A status ${rd.status}`);
  const checks: [string, bigint, bigint][] = [["fund", await holding(A.fund, "Series A Preferred"), 4_500_000n], ["safe1", await holding(A.chidi, "SAFE 1 shadow preferred"), 1_000_000n], ["safe2", await holding(A.dayo, "SAFE 2 shadow preferred"), 250_000n], ["pool", await holding("unissued_pool", "Common"), 1_500_000n]];
  for (const [n, got, want] of checks) { if (got !== want) throw new Error(`holding ${n}: ${got} != ${want}`); log(`holding ${n} = ${got} (GV-1 ok)`); }

  // ---- step 6: three attacks
  expectFail("a stranger calls approve_round", () => sendRaw(A.core, "approve_round", { round_id: a.rid, plan_hash: a.hash }, A.efe));
  const before = await bal(A.chidi, A.fake);
  ft(A.chidi, A.core, 50n * M, { action: "round", id: a.rid }, "6", "chidi deposits the WRONG token", A.fake);
  const after = await bal(A.chidi, A.fake); if (before !== after) throw new Error("wrong token not refunded"); log("wrong-token deposit refunded in full");
  expectFail("close_round runs a second time", () => sendRaw(A.core, "close_round", { round_id: a.rid }, A.zed));
  if (await holding(A.fund, "Series A Preferred") !== 4_500_000n) throw new Error("double close changed holdings");

  // ---- step 7: grant and cliff
  const strike = res.priceMicro;
  // start the vesting clock after the board's two votes will have landed, so the cliff check is not early
  const startMs = Date.now() + 60_000; const startNs = BigInt(startMs) * 1_000_000n;
  const grant = { grantee: A.efe, shares: "100000", strike_micro: strike.toString(), start_ns: Number(startNs), term_months: 48, cliff_months: 12 };
  const gcanon = canonicalJson(grant); const ghash = await sha(gcanon);
  await dao("7", "board grants Efe 100,000 options at $2.00", A.core, "grant", { plan_hash: ghash, plan: gcanon });
  const cliffAt = startMs + 12 * Number(MONTH_NS / 1_000_000n) + 6_000;
  log(`waiting ${Math.max(0, Math.round((cliffAt - Date.now()) / 1000))} s for the demo clock to pass the cliff (12 'months' x 5 s)...`); await sleep(Math.max(0, cliffAt - Date.now()));
  const v = BigInt(await view(A.core, "vested", { grant_id: 1 }));
  const cliffV = vested({ totalShares: 100_000n, termMonths: 48, cliffMonths: 12 }, 12), nextV = vested({ totalShares: 100_000n, termMonths: 48, cliffMonths: 12 }, 13);
  log(`vested just after the cliff: ${v} (engine: ${cliffV} at month 12, ${nextV} at month 13)`);
  if (v !== cliffV && v !== nextV) throw new Error("on-chain vesting disagrees with the engine");
  // ---- step 8: exit at $20M (GV-2)
  const E = 20_000_000n * M;
  const w = waterfall({ classes: { safe1: { shares: 1_000_000n, preferenceMicro: 500_000n * M }, safe2: { shares: 250_000n, preferenceMicro: 250_000n * M }, fund: { shares: 4_500_000n, preferenceMicro: 9_000_000n * M } }, commonShares: { ada: 5_000_000n, bayo: 2_750_000n }, options: { efe: { shares: 100_000n, strikeMicro: strike } }, proceedsMicro: E });
  if (w.exercised.length) throw new Error("efe should be out of the money at $20M");
  const who: Record<string, string> = { ada: A.ada, bayo: A.bayo, safe1: A.chidi, safe2: A.dayo, fund: A.fund };
  const payouts = Object.entries(who).map(([k, acct]) => [acct, w.payoutsMicro[k].toString()]);
  const xplan = { payouts }; const xcanon = canonicalJson(xplan); const xhash = await sha(xcanon);
  const total = payouts.reduce((s, p) => s + BigInt(p[1]), 0n);
  const x = call("8", "ada proposes the $20M exit", A.core, "propose_exit", { plan_hash: xhash, plan_uri: "ipfs://exit-20m", plan: xcanon }, A.ada);
  await ft(A.zed, A.core, total, { action: "exit", id: x.ret }, "8", `zed funds the exit ($${Number(total) / 1e6})`);
  await dao("8", "board approves the exit by plan hash", A.core, "approve_exit", { exit_id: x.ret, plan_hash: xhash });
  const pre = await Promise.all(Object.values(who).map((a) => bal(a)));
  call("8", "anyone runs distribute", A.core, "distribute", { exit_id: x.ret, from: 0, limit: 5 }, A.zed, { gas: "250 Tgas" });
  await sleep(8000);
  const post = await Promise.all(Object.values(who).map((a) => bal(a)));
  Object.keys(who).forEach((k, i) => { const got = post[i] - pre[i]; if (got !== w.payoutsMicro[k]) throw new Error(`payout ${k}: ${got} != ${w.payoutsMicro[k]}`); log(`payout ${k} = ${Number(got) / 1e6} (GV-2 ok)`); });
  const efeBal = await bal(A.efe); log(`efe options out of the money: efe token balance ${efeBal}`);

  // ---- step 9: verify (recompute and compare with chain)
  const verified: string[] = []; let failed = 0;
  for (const [rid, canon] of Object.entries(planByRound)) {
    const r = await view(A.core, "round", { round_id: Number(rid) }); const h = await sha(canon);
    const ok = r.plan_hash === h && r.plan === canon && r.status === "Closed"; if (!ok) failed++;
    verified.push(`${ok ? "PASS" : "FAIL"} round ${rid} (${r.kind}): recomputed plan hash ${h.slice(0, 16)}… matches chain, status ${r.status}`);
  }
  const ex = await view(A.core, "exit", { exit_id: x.ret }); const okx = ex.plan_hash === xhash && ex.payouts.every((p: any) => p.state === "Paid"); if (!okx) failed++;
  verified.push(`${okx ? "PASS" : "FAIL"} exit ${x.ret}: plan hash matches chain, all payouts Paid`);
  verified.forEach((l) => log(l)); log(`${failed} failed`);

  // ---- outputs
  mkdirSync("results", { recursive: true });
  const addresses = { network: NET, suffix: S, dao: DAO, rounds: A.core, token: A.usdc, fakeToken: A.fake, accounts: A };
  writeFileSync("results/demo-addresses.json", JSON.stringify(addresses, null, 2));
  writeFileSync("results/demo-txs.json", JSON.stringify(txs, null, 2));
  writeFileSync("results/demo-plans.json", JSON.stringify({ rounds: planByRound, exit: { id: x.ret, plan: xcanon }, grant: { plan: gcanon } }, null, 2));
  writeFileSync("web/public/deployment.json", JSON.stringify({ network: NET, rpc: RPC, explorer: EXPLORER, rounds: A.core, board: DAO, token: A.usdc }, null, 2));
  await collectEvents();
  writeFileSync("web/public/events.json", JSON.stringify(events, null, 1));
  writeFileSync("results/demo-events.json", JSON.stringify(events, null, 1));
  log(`${events.length} events collected`);
  if (failed) process.exit(1);
}
void existsSync;
main().catch((e) => { console.error(e); process.exit(1); });
