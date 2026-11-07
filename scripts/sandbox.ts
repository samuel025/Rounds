// make sandbox: deploys an OPEN sandbox on NEAR testnet for judges. Founders and two SAFEs are already closed; the Series A is left to try.
// Its board is the OPEN BOARD contract (contract/open-board): anyone may ask it to act as the board for this one Rounds contract.
// (Sputnik cannot give every visitor a vote: its "Everyone" role fails with ERR_UNSUPPORTED_ROLE when votes are counted.) Testnet only; the token has no value.
// Creates throwaway accounts (faucet first; SANDBOX_FUND_FROM=acct1,acct2 funds from spare testnet accounts if the faucet refuses).
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { canonicalJson, planHash } from "../src/engine/index";

const NET = "testnet", RPC = process.env.RPC_URL ?? "https://test.rpc.fastnear.com", EXPLORER = "https://testnet.nearblocks.io";
const M = 1_000_000n;
const S = process.env.SANDBOX_SUFFIX ?? String(Date.now()).slice(-6);
const id = (n: string) => `rsbx-${n}-${S}.testnet`;
const A = { ada: id("ada"), bayo: id("bayo"), chidi: id("chidi"), dayo: id("dayo"), usdc: process.env.SANDBOX_TOKEN ?? id("usdc"), rounds: id("rounds"), board: id("board") }; // SANDBOX_TOKEN reuses an already deployed test token (saves testnet NEAR)
const MONTH_NS = 5_000_000_000n, WINDOW_NS = 15_000_000_000n; // demo clock: one "month" = 5 s
const NEED: Record<string, number> = { ada: 1.5, rounds: 4.5, board: 1.5, usdc: 3.5, chidi: 0.8, dayo: 0.8, bayo: 0.5 }; // NEAR, only used for the fallback funding

async function rfetch(url: string, init: RequestInit): Promise<Response> {
  for (let i = 1; ; i++) { try { return await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }); } catch (e) { if (i >= 6) throw e; await new Promise((r) => setTimeout(r, 1500 * i)); } }
}
const log = (m: string) => console.log(`[sandbox] ${m}`);
const txs: { step: string; tx: string; what: string; signer?: string }[] = [];

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
async function rpcQuery(params: object) {
  const res = await rfetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params }) });
  return (await res.json()) as any;
}
async function view(contract: string, method: string, args: object = {}) {
  const j = await rpcQuery({ request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  if (j.error || j.result?.error) throw new Error(JSON.stringify(j.error ?? j.result.error));
  return JSON.parse(Buffer.from(j.result.result).toString());
}
const account = async (a: string) => { const j = await rpcQuery({ request_type: "view_account", finality: "final", account_id: a }); return j.result as { amount: string; code_hash: string } | undefined; };
const exists = async (a: string) => !!(await account(a));
const hasCode = async (a: string) => { const r = await account(a); return !!r && r.code_hash !== "11111111111111111111111111111111"; };
const nearBalance = async (a: string) => { const r = await account(a); return r ? Number(BigInt(r.amount) / 10n ** 20n) / 1e4 : 0; };
const ft = (who: string, to: string, amount: bigint, msg: object, step: string, what: string) =>
  call(step, what, A.usdc, "ft_transfer_call", { receiver_id: to, amount: amount.toString(), msg: JSON.stringify(msg) }, who, { deposit: "1 yoctoNEAR", gas: "200 Tgas" });

// Create an account: faucet first; if it refuses, fund it from spare testnet accounts (richest first), topping up in several transfers.
async function createAccount(k: string, acct: string) {
  try { near(["account", "create-account", "sponsor-by-faucet-service", acct, "autogenerate-new-keypair", "save-to-legacy-keychain", "network-config", NET, "create"]); log(`created ${k}: ${acct} (faucet)`); return; }
  catch (e) { if (await exists(acct)) { log(`created ${k}: ${acct} (faucet)`); return; } log(`faucet refused ${k}: ${(e as Error).message.split("\n")[0].slice(0, 80)}`); }
  const sources = (process.env.SANDBOX_FUND_FROM ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!sources.length) throw new Error("faucet refused and SANDBOX_FUND_FROM is not set");
  let remaining = NEED[k], created = false;
  while (remaining > 0.001) {
    let best: [string, number] = ["", 0]; for (const s of sources) { const b = await nearBalance(s); if (b > best[1]) best = [s, b]; }
    const give = Math.min(remaining, best[1] - 0.4); if (give < 0.05) throw new Error(`not enough spare NEAR to fund ${k}`);
    const amt = `${give.toFixed(2)} NEAR`;
    if (!created) near(["account", "create-account", "fund-myself", acct, amt, "autogenerate-new-keypair", "save-to-legacy-keychain", "sign-as", best[0], "network-config", NET, "sign-with-legacy-keychain", "send"]);
    else near(["tokens", best[0], "send-near", acct, amt, "network-config", NET, "sign-with-legacy-keychain", "send"]);
    created = true; remaining -= Number(give.toFixed(2)); log(`funded ${k} ${amt} from ${best[0]}`);
  }
}

// The open board acts for the Rounds contract when anyone asks (allow-listed methods only).
function board(what: string, method: string, args: object) {
  return call("board", `open board: ${what}`, A.board, "act", { method_name: method, args: JSON.stringify(args), gas_tgas: 60 }, A.ada, { gas: "150 Tgas" });
}

async function main() {
  log(`suffix ${S}`);
  for (const [k, a] of Object.entries(A)) { if (await exists(a)) { log(`exists ${k}: ${a}`); continue; } await createAccount(k, a); }

  const deploy = async (acct: string, wasm: string, init: string, args: object, what: string) => {
    if (await hasCode(acct)) { log(`already deployed ${acct}`); return; }
    near(["contract", "deploy", acct, "use-file", wasm, "with-init-call", init, "json-args", JSON.stringify(args), "prepaid-gas", "50 Tgas", "attached-deposit", "0 NEAR", "network-config", NET, "sign-with-legacy-keychain", "send"]); log(what);
  };
  await deploy(A.board, "contract/open-board/target/near/open_board.wasm", "new", { target: A.rounds }, "deployed the open board for the Rounds contract");
  await deploy(A.usdc, "contract/mock-ft/target/near/mock_ft.wasm", "new", { faucet_cap: (100_000_000n * M).toString() }, "deployed sandbox test USDC (public faucet, no value)");
  const classes = ["Common", "Series A Preferred", "SAFE 1 shadow preferred", "SAFE 2 shadow preferred"].map((c) => ({ id: c, authorized: "100000000" }));
  await deploy(A.rounds, "contract/target/near/rounds.wasm", "new", { board: A.board, payment_token: A.usdc, classes, month_ns: Number(MONTH_NS), exercise_window_ns: Number(WINDOW_NS) }, "deployed Rounds with the open board as its board");
  for (const a of [A.ada, A.bayo, A.chidi, A.dayo, A.rounds, A.board]) call("1", `register ${a} for test USDC`, A.usdc, "storage_deposit", { account_id: a }, A.ada);
  call("1", "faucet: chidi $500,000", A.usdc, "faucet", { account_id: A.chidi, amount: (500_000n * M).toString() }, A.ada);
  call("1", "faucet: dayo $250,000", A.usdc, "faucet", { account_id: A.dayo, amount: (250_000n * M).toString() }, A.ada);
  board("makes ada an officer", "set_officer", { account: A.ada, enabled: true });

  const propose = async (kind: string, plan: object, raise: [string, bigint][], uri: string) => {
    const canon = canonicalJson(plan); const hash = await planHash(canon);
    const r = call("2", `ada proposes ${kind} round`, A.rounds, "propose_round", JSON.stringify({ kind, plan_hash: hash, plan_uri: uri, plan: canon, raise: raise.map(([a, v]) => [a, v.toString()]), deadline_ns: "__MAX_U64__" }).replace('"__MAX_U64__"', "18446744073709551615"), A.ada);
    return { rid: r.ret as number, hash };
  };
  const approveClose = async (rid: number, hash: string, label: string) => {
    board(`approves ${label} by plan hash`, "approve_round", { round_id: rid, plan_hash: hash });
    call("2", `anyone closes ${label}`, A.rounds, "close_round", { round_id: rid }, A.ada, { gas: "100 Tgas" });
  };
  const f = await propose("Founder", { issuances: [{ class: "Common", holder: A.ada, shares: "5000000" }, { class: "Common", holder: A.bayo, shares: "2750000" }, { class: "Common", holder: "unissued_pool", shares: "1000000" }] }, [], "ipfs://founders");
  await approveClose(f.rid, f.hash, "founder issuance");
  const safeSpec = [{ id: "safe1", holder: A.chidi, amt: 500_000n, cap: 5_000_000n }, { id: "safe2", holder: A.dayo, amt: 250_000n, cap: 10_000_000n }];
  for (const s of safeSpec) {
    const p = await propose("Safe", { safes: [{ id: s.id, holder: s.holder, amount: (s.amt * M).toString(), post_money_cap: (s.cap * M).toString(), discount_bps: 0, converted: false }] }, [[s.holder, s.amt * M]], `ipfs://${s.id}`);
    await ft(s.holder, A.rounds, s.amt * M, { action: "round", id: p.rid }, "3", `${s.id} holder pays $${s.amt} into escrow`);
    await approveClose(p.rid, p.hash, s.id);
  }
  const last = await view(A.rounds, "round", { round_id: 3 });
  if (last.status !== "Closed") throw new Error(`last SAFE round is ${last.status}`);
  mkdirSync("results", { recursive: true });
  const dep = { network: NET, rpc: RPC, explorer: EXPLORER, rounds: A.rounds, board: A.board, token: A.usdc, openBoard: true, note: "OPEN SANDBOX: anyone may become an officer and act as the board. Founders and two SAFEs are closed; the Series A is yours to run. Testnet, no value." };
  writeFileSync("results/sandbox.json", JSON.stringify({ suffix: S, accounts: A, deployment: dep, txs }, null, 2));
  writeFileSync("web/public/sandbox.json", JSON.stringify(dep, null, 2)); // the newest sandbox, kept for older readers
  // the pool: the app gives each visitor the first sandbox whose Series A has not been run yet (a sandbox can run only one)
  const pool: any[] = existsSync("web/public/sandboxes.json") ? JSON.parse(readFileSync("web/public/sandboxes.json", "utf8")) : [];
  pool.push(dep); writeFileSync("web/public/sandboxes.json", JSON.stringify(pool.slice(-12), null, 2));
  log(`done. sandbox contract ${A.rounds}, open board ${A.board}, token ${A.usdc}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
