// make tokens: demo step 11, on testnet, after `make demo`. SAFTs and a project token, end to end, on a SECOND Rounds contract that uses the
// demo's DAO as board and treasury and its test USDC as the payment token:
//   a Saft round is sold and funded; at launch the DAO funds a token reserve and approves a conversion plan by hash; the contract recomputes
//   every token count itself (RULES.md R11); holders claim tokens as they vest; the DAO also grants a contributor tokens from the same reserve.
// Testnet only, no value. Needs the `near` CLI, network, the demo accounts' keys, and ~8 testnet NEAR from TOKENS_FUND_FROM=<old suffixes>.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { canonicalJson, planHash, sealPlan, saftConversionPlan, convertSafts, unlockedTokens, type Saft } from "../src/engine/index";

const addr = JSON.parse(readFileSync("results/demo-addresses.json", "utf8"));
const S = addr.suffix as string, DAO = addr.dao as string, USDC = addr.token as string, A = addr.accounts as Record<string, string>;
const CORE = `rounds-tok-${S}.testnet`, TKN = `rounds-tkn-${S}.testnet`;
const NET = "testnet", RPC = process.env.RPC_URL ?? "https://test.rpc.fastnear.com";
const M = 1_000_000n, DEC = 6, MONTH_NS = 5_000_000_000n; // demo clock: one "month" is 5 seconds
const SUPPLY_WHOLE = 1_000_000_000n, SUPPLY = SUPPLY_WHOLE * 10n ** BigInt(DEC); // 1e9 tokens, counted in base units
const LAUNCH_PRICE_MICRO = 15_000n; // $0.015 a token
const RESERVE = 100_000_000n * 10n ** BigInt(DEC); // the DAO funds 100,000,000 tokens
const EFE_GRANT = 1_000_000n * 10n ** BigInt(DEC);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`[tokens] ${m}`);
const txs: { step: string; tx: string; what: string; signer?: string }[] = [];
const attacks: { step: string; what: string; signer: string; tx: string; error: string }[] = [];

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
function sendRaw(contract: string, method: string, args: object | string, signer: string, opts: { deposit?: string; gas?: string; mode?: "send" | "display" } = {}) {
  return near(["contract", "call-function", "as-transaction", contract, method, "json-args", typeof args === "string" ? args : JSON.stringify(args), "prepaid-gas", opts.gas ?? "100 Tgas", "attached-deposit", opts.deposit ?? "0 NEAR", "sign-as", signer, "network-config", NET, "sign-with-legacy-keychain", opts.mode ?? "send"]);
}
function call(step: string, what: string, contract: string, method: string, args: object | string, signer: string, opts: { deposit?: string; gas?: string } = {}) {
  const out = sendRaw(contract, method, args, signer, opts);
  const tx = parseTx(out); txs.push({ step, tx, what, signer }); log(`${step} ${what} ${tx.slice(0, 8)}`);
  return { tx, ret: parseRet(out) };
}
async function rpcQuery(params: object) { return (await (await rfetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params }) })).json()) as any; }
async function view(contract: string, method: string, args: object = {}, block?: string) {
  const j = await rpcQuery({ request_type: "call_function", ...(block ? { block_id: block } : { finality: "final" }), account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  if (j.error || j.result?.error) throw new Error(JSON.stringify(j.error ?? j.result.error));
  return JSON.parse(Buffer.from(j.result.result).toString());
}
const account = async (a: string) => (await rpcQuery({ request_type: "view_account", finality: "final", account_id: a })).result as { amount: string } | undefined;
const nearBal = async (a: string) => { const r = await account(a); return r ? Number(BigInt(r.amount) / 10n ** 20n) / 1e4 : 0; };
const bal = async (token: string, who: string) => BigInt(await view(token, "ft_balance_of", { account_id: who }));
const ftCall = (who: string, token: string, to: string, amount: bigint, msg: object, step: string, what: string) =>
  call(step, what, token, "ft_transfer_call", { receiver_id: to, amount: amount.toString(), msg: JSON.stringify(msg) }, who, { deposit: "1 yoctoNEAR", gas: "200 Tgas" });

/** One DAO proposal executed by two council votes (fund + indep), as in the demo. */
async function dao(step: string, what: string, receiver: string, method: string, args: object, gas: string, deposit: string, voteGas: string) {
  const prop = { proposal: { description: what, kind: { FunctionCall: { receiver_id: receiver, actions: [{ method_name: method, args: Buffer.from(JSON.stringify(args)).toString("base64"), deposit, gas }] } } } };
  const pid = call(step, `DAO proposal: ${what}`, DAO, "add_proposal", prop, A.fund, { deposit: "0.1 NEAR" }).ret as number;
  call(step, `DAO vote 1/2 (fund) on #${pid}`, DAO, "act_proposal", { id: pid, action: "VoteApprove" }, A.fund);
  call(step, `DAO vote 2/2 (indep) on #${pid}: executes ${method}`, DAO, "act_proposal", { id: pid, action: "VoteApprove" }, A.indep, { gas: voteGas });
  const p = await view(DAO, "get_proposal", { id: pid });
  if (p.status !== "Approved") throw new Error(`proposal ${pid} is ${p.status}`);
}
async function attackFail(step: string, what: string, contract: string, method: string, args: object | string, signer: string, expectMsg: string) {
  const out = sendRaw(contract, method, args, signer, { mode: "display" }).replace(/\x1b\[[0-9;]*m/g, "");
  const b64 = out.match(/serialized as base64\):\s*\n(\S+)/)?.[1]; if (!b64) throw new Error("no signed transaction in CLI output");
  const j: any = await (await rfetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "send_tx", params: { signed_tx_base64: b64, wait_until: "FINAL" } }) })).json();
  const r = j.result; if (!r) throw new Error(`send_tx failed: ${JSON.stringify(j.error).slice(0, 200)}`);
  const fail = r.status?.Failure; if (!fail || !JSON.stringify(fail).includes(expectMsg)) throw new Error(`attack "${what}" did not fail as expected: ${JSON.stringify(r.status).slice(0, 300)}`);
  attacks.push({ step, what, signer, tx: r.transaction.hash, error: expectMsg }); log(`ATTACK FAILED AS EXPECTED: ${what} (${r.transaction.hash.slice(0, 8)}: ${expectMsg})`);
}

async function main() {
  if (await account(CORE)) throw new Error(`${CORE} already exists: the token demo has been run on this deployment`);
  const old = (process.env.TOKENS_FUND_FROM ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const sources = old.flatMap((o) => ["ada", "fund", "indep", "bayo", "chidi", "dayo", "efe", "zed"].map((n) => `rounds-${n}-${o}.testnet`));
  if (!sources.length) throw new Error("set TOKENS_FUND_FROM=<old demo suffixes> (about 8 testnet NEAR are needed for two contracts)");
  async function create(acct: string, need: number) {
    let remaining = need, created = false;
    while (remaining > 0.001) {
      let best: [string, number] = ["", 0]; for (const s of sources) { const b = await nearBal(s); if (b > best[1]) best = [s, b]; }
      const give = Math.min(remaining, best[1] - 0.35); if (give < 0.05) throw new Error(`not enough spare testnet NEAR to fund ${acct} (${remaining.toFixed(2)} short)`);
      const amt = `${give.toFixed(2)} NEAR`;
      if (!created) near(["account", "create-account", "fund-myself", acct, amt, "autogenerate-new-keypair", "save-to-legacy-keychain", "sign-as", best[0], "network-config", NET, "sign-with-legacy-keychain", "send"]);
      else near(["tokens", best[0], "send-near", acct, amt, "network-config", NET, "sign-with-legacy-keychain", "send"]);
      created = true; remaining -= Number(give.toFixed(2)); log(`funded ${acct} ${amt} from ${best[0]}`);
    }
  }
  await create(CORE, 4.8); await create(TKN, 2.5);
  const deploy = (acct: string, wasm: string, args: object, what: string) => {
    const out = near(["contract", "deploy", acct, "use-file", wasm, "with-init-call", "new", "json-args", JSON.stringify(args), "prepaid-gas", "50 Tgas", "attached-deposit", "0 NEAR", "network-config", NET, "sign-with-legacy-keychain", "send"]);
    txs.push({ step: "11", tx: parseTx(out), what, signer: acct }); log(what);
  };
  deploy(TKN, "contract/mock-ft/target/near/mock_ft.wasm", { faucet_cap: (10n ** 18n).toString() }, "deploy the project token (a test NEP-141, 6 decimals, no value)");
  deploy(CORE, "contract/target/near/rounds.wasm", { board: DAO, treasury: DAO, payment_token: USDC, classes: [{ id: "Common", authorized: "100000000" }], month_ns: Number(MONTH_NS), exercise_window_ns: 15_000_000_000 }, "deploy a second Rounds contract: the DAO is its board and treasury, the demo USDC its payment token");
  call("11", "register the contract for test USDC", USDC, "storage_deposit", { account_id: CORE }, A.ada);
  for (const a of [DAO, CORE, A.chidi, A.dayo, A.efe]) call("11", `register ${a} for the project token`, TKN, "storage_deposit", { account_id: a }, A.ada);
  call("11", "faucet: chidi $500,000 test USDC", USDC, "faucet", { account_id: A.chidi, amount: (500_000n * M).toString() }, A.ada);
  call("11", "faucet: dayo $250,000 test USDC", USDC, "faucet", { account_id: A.dayo, amount: (250_000n * M).toString() }, A.ada);
  call("11", "faucet: the DAO receives 100,000,000 project tokens", TKN, "faucet", { account_id: DAO, amount: RESERVE.toString() }, A.ada);
  await dao("11", "board makes ada an officer", CORE, "set_officer", { account: A.ada, enabled: true }, "60000000000000", "0", "200 Tgas");
  await dao("11", "board names the project token (6 decimals), once", CORE, "set_project_token", { token: TKN, decimals: DEC }, "60000000000000", "0", "200 Tgas");

  // ---- the SAFT round: sold and funded like a SAFE round
  const safts: Saft[] = [
    { id: "saft1", holder: A.chidi, amountMicro: 500_000n * M, fdvCapMicro: 20_000_000n * M, discountBps: 0 },
    { id: "saft2", holder: A.dayo, amountMicro: 250_000n * M, fdvCapMicro: 20_000_000n * M, discountBps: 2000 },
  ];
  const body = { safts: safts.map((s) => ({ id: s.id, holder: s.holder, amount: s.amountMicro.toString(), fdv_cap: s.fdvCapMicro.toString(), discount_bps: s.discountBps, converted: false })) };
  const raise: [string, bigint][] = safts.map((s) => [s.holder, s.amountMicro]);
  const propose = (plan: object, r: [string, bigint][]) => { const canon = canonicalJson(plan); return { canon, args: JSON.stringify({ kind: "Saft", plan_hash: "", plan_uri: "ipfs://saft-round", plan: canon, raise: r.map(([a, v]) => [a, v.toString()]), deadline_ns: "__MAX_U64__" }).replace('"__MAX_U64__"', "18446744073709551615") }; };
  const cheapPlan = sealPlan(body, { kind: "Saft", raise: [[A.chidi, 1n], [A.dayo, 250_000n * M]] });
  const cheap = propose(cheapPlan, [[A.chidi, 1n], [A.dayo, 250_000n * M]]);
  await attackFail("11", "an officer proposes a $500,000 SAFT that its investor buys for $1", CORE, "propose_round", cheap.args.replace('"plan_hash":""', `"plan_hash":"${await planHash(cheap.canon)}"`), A.ada, "an investor's raise must equal their SAFT amounts");
  const sealed = canonicalJson(sealPlan(body, { kind: "Saft", raise })), sealedHash = await planHash(sealed);
  const round = call("11", "ada proposes the Saft round", CORE, "propose_round", JSON.stringify({ kind: "Saft", plan_hash: sealedHash, plan_uri: "ipfs://saft-round", plan: sealed, raise: raise.map(([a, v]) => [a, v.toString()]), deadline_ns: "__MAX_U64__" }).replace('"__MAX_U64__"', "18446744073709551615"), A.ada).ret as number;
  await ftCall(A.chidi, USDC, CORE, 500_000n * M, { action: "round", id: round }, "11", "saft1 holder pays $500,000 into escrow");
  await ftCall(A.dayo, USDC, CORE, 250_000n * M, { action: "round", id: round }, "11", "saft2 holder pays $250,000 into escrow");
  await dao("11", "board approves the Saft round by plan hash", CORE, "approve_round", { round_id: round, plan_hash: sealedHash }, "60000000000000", "0", "200 Tgas");
  call("11", "anyone closes the Saft round", CORE, "close_round", { round_id: round }, A.zed, { gas: "100 Tgas" });
  if ((await view(CORE, "round", { round_id: round })).status !== "Closed") throw new Error("the Saft round did not close");
  for (const s of safts) if ((await view(CORE, "saft", { id: s.id })).converted !== false) throw new Error(`${s.id} is not recorded`);

  // ---- launch: the DAO funds the reserve, then approves the conversion plan; the contract recomputes every number
  await dao("11", "board funds the token reserve from the treasury (100,000,000 tokens)", TKN, "ft_transfer_call", { receiver_id: CORE, amount: RESERVE.toString(), msg: JSON.stringify({ action: "reserve" }) }, "120000000000000", "1", "300 Tgas");
  if (BigInt((await view(CORE, "token_info"))[2]) !== RESERVE) throw new Error("the reserve does not hold what the DAO sent");
  const tge = { totalSupply: SUPPLY, launchPriceMicro: LAUNCH_PRICE_MICRO, decimals: DEC };
  const eng = convertSafts(safts, tge);
  const startMs = Date.now() + 75_000, startNs = BigInt(startMs) * 1_000_000n; // the vesting clock starts after the votes will have landed
  const vesting = { startNs, termMonths: 6, cliffMonths: 2 };
  const convPlan = canonicalJson(saftConversionPlan(safts, tge, vesting)), convHash = await planHash(convPlan);
  log(`engine: ${eng.results.map((r) => `${r.id} ${r.tokens} units (${r.regime})`).join("; ")}; investors get ${eng.shareOfSupply.num}/${eng.shareOfSupply.den} of the supply`);
  await dao("11", "board converts the SAFTs by plan hash", CORE, "convert_safts", { plan_hash: convHash, plan: convPlan }, "100000000000000", "0", "300 Tgas");
  const grantPlan = canonicalJson({ cliff_months: 2, grantee: A.efe, start_ns: startNs.toString(), term_months: 6, tokens: EFE_GRANT.toString() }), grantHash = await planHash(grantPlan);
  await dao("11", "board rewards a contributor with 1,000,000 tokens from the same reserve", CORE, "grant_tokens", { plan_hash: grantHash, plan: grantPlan }, "60000000000000", "0", "200 Tgas");
  const chain = await Promise.all([1, 2, 3].map((id) => view(CORE, "token_grant", { grant_id: id })));
  eng.results.forEach((r, i) => { if (chain[i].grantee !== r.holder || chain[i].tokens !== r.tokens.toString() || chain[i].saft_id !== r.id) throw new Error(`grant ${i + 1} differs from the engine: ${JSON.stringify(chain[i])}`); });
  log(`grants on chain equal the engine: ${chain.map((g) => g.tokens).join(", ")}`);

  // ---- vesting: read a block in month 4 and compare with the engine's unlock schedule
  log("waiting for the chain clock to reach month 4 of vesting ...");
  let pin: { hash: string; ts: bigint } | undefined;
  for (let i = 0; i < 600 && !pin; i++) {
    const bj: any = await (await rfetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "block", params: { finality: "final" } }) })).json();
    const ts = BigInt(bj.result.header.timestamp); if (ts >= startNs + 4n * MONTH_NS) pin = { hash: bj.result.header.hash, ts }; else await sleep(500);
  }
  if (!pin) throw new Error("month 4 never reached");
  const month = Number((pin.ts - startNs) / MONTH_NS); if (month >= 6) throw new Error("block already past the term; rerun");
  const v1 = BigInt(await view(CORE, "token_vested", { grant_id: 1 }, pin.hash));
  const want = unlockedTokens(eng.results[0].tokens, { termMonths: 6, cliffMonths: 2 }, month);
  log(`vested at block ${pin.hash.slice(0, 8)} (month ${month}): ${v1} (engine: ${want})`);
  if (v1 !== want) throw new Error(`on-chain unlock ${v1} != engine ${want}`);
  // ---- the term ends; anyone triggers each claim and the tokens reach the holders
  for (let i = 0; i < 600; i++) { const bj: any = await (await rfetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "block", params: { finality: "final" } }) })).json(); if (BigInt(bj.result.header.timestamp) >= startNs + 6n * MONTH_NS + 3_000_000_000n) break; await sleep(500); }
  for (const id of [1, 2, 3]) call("11", `anyone claims vested tokens for grant ${id}`, CORE, "claim_tokens", { grant_id: id }, A.zed, { gas: "100 Tgas" });
  await sleep(10_000);
  const wantBal: [string, bigint][] = [[A.chidi, eng.results[0].tokens], [A.dayo, eng.results[1].tokens], [A.efe, EFE_GRANT]];
  for (const [who, tokens] of wantBal) { const got = await bal(TKN, who); if (got !== tokens) throw new Error(`${who} holds ${got} tokens, expected ${tokens}`); log(`${who} holds ${got} tokens (matches the engine)`); }
  const info = await view(CORE, "token_info"); const claimed = eng.results[0].tokens + eng.results[1].tokens + EFE_GRANT;
  if (BigInt(info[2]) !== RESERVE - claimed || BigInt(info[3]) !== 0n || BigInt(info[4]) !== 0n) throw new Error(`reserve accounting is off: ${JSON.stringify(info)}`);
  log(`reserve left ${info[2]}, nothing in flight, no open claims`);

  // ---- outputs: events from every transaction of this step, plus the plans
  const events: { name: string; tx: string; data: any }[] = [];
  for (const t of txs) {
    if (!t.tx || !t.signer) continue; let res: any = null;
    for (let i = 1; i <= 6 && !res; i++) {
      try { const r: any = await (await rfetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "EXPERIMENTAL_tx_status", params: { tx_hash: t.tx, sender_account_id: t.signer, wait_until: "FINAL" } }) })).json(); if (r.result) res = r.result; else throw new Error(JSON.stringify(r.error).slice(0, 100)); }
      catch (err) { if (i === 6) throw new Error(`could not read tx ${t.tx}: ${(err as Error).message}`); await sleep(2000 * i); }
    }
    for (const ro of res.receipts_outcome ?? []) for (const l of ro.outcome.logs as string[]) { if (!l.startsWith("EVENT_JSON:")) continue; const e = JSON.parse(l.slice(11)); if (e.standard === "rounds") events.push({ name: e.event, tx: t.tx, data: e.data }); }
  }
  writeFileSync("results/tokens-addresses.json", JSON.stringify({ network: NET, suffix: S, rounds: CORE, token: TKN, dao: DAO, payment_token: USDC, decimals: DEC, accounts: A }, null, 2));
  writeFileSync("results/tokens-txs.json", JSON.stringify(txs, null, 2));
  writeFileSync("results/tokens-attacks.json", JSON.stringify(attacks, null, 2));
  writeFileSync("results/tokens-events.json", JSON.stringify(events, null, 1));
  writeFileSync("results/tokens-plans.json", JSON.stringify({ round: { id: round, plan: sealed }, conversion: { plan: convPlan, hash: convHash }, grant: { plan: grantPlan, hash: grantHash }, vestingStartNs: startNs.toString() }, null, 2));
  log(`${txs.length} transactions and ${events.length} events written to results/tokens-*.json`);
}
void existsSync;
main().catch((e) => { console.error(e); process.exit(1); });
