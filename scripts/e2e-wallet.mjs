// End-to-end check of the app's wallet buttons against NEAR testnet, using throwaway demo accounts whose keys are in
// ~/.near-credentials (never in the repo). The app (vite dev server, DEV only) is given a test signer instead of a wallet
// popup; everything else (button logic, the transactions it builds, the contract's answers) is the real thing.
//   node scripts/e2e-wallet.mjs [app url]      (needs `make web-dev` running, the near CLI, Chrome)
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP = process.argv[2] ?? "http://127.0.0.1:5173/";
const RPC = process.env.RPC_URL ?? "https://test.rpc.fastnear.com";
const NEW = "052090", OLD = "372231"; // current deployment and a superseded one used for the writes that would pollute the current one
const acct = (n, s) => `rounds-${n}-${s}.testnet`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0, total = 0;
const check = (ok, msg) => { total++; if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

async function rpc(method, params) { const j = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json(); if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200)); return j.result; }
const view = async (contract, method, args) => JSON.parse(Buffer.from((await rpc("query", { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") })).result).toString());

// sign with the near CLI (display), broadcast over RPC ourselves, so failures also return an outcome like a wallet would
async function signAndSend(signer, receiver, act) {
  const args = ["contract", "call-function", "as-transaction", receiver, act.method, "json-args", act.args, "prepaid-gas", `${act.gasTgas} Tgas`, "attached-deposit", `${act.depositYocto} yoctoNEAR`, "sign-as", signer, "network-config", "testnet", "sign-with-legacy-keychain", "display"];
  const r = spawnSync("near", args, { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  const out = ((r.stderr ?? "") + (r.stdout ?? "")).replace(/\x1b\[[0-9;]*m/g, "");
  const b64 = out.match(/serialized as base64\):\s*\n(\S+)/)?.[1]; if (!b64) throw new Error("signing failed: " + out.slice(-300));
  return rpc("send_tx", { signed_tx_base64: b64, wait_until: "FINAL" });
}
async function execActs(signer, receiver, acts) { let last; for (const a of acts) { last = await signAndSend(signer, receiver, a); if (last.status?.Failure) return last; } return last; }

const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9336", "--window-size=1280,900", `--user-data-dir=${mkdtempSync(join(tmpdir(), "e2e-"))}`, "about:blank"], { stdio: "ignore" });
let ws, mid = 0; const pend = new Map(); const bindings = [];
async function open() {
  let t; for (let i = 0; i < 50; i++) { try { t = (await (await fetch("http://127.0.0.1:9336/json")).json()).find((x) => x.type === "page"); if (t) break; } catch {} await sleep(200); }
  ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } else if (j.method === "Runtime.bindingCalled") bindings.push(j.params); };
}
const send = (method, params = {}) => new Promise((r) => { const i = ++mid; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };

async function session(account, contract, hash = "") {
  await send("Page.enable"); await send("Runtime.enable"); await send("Runtime.addBinding", { name: "nodeSend" });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__testWallet = { account: ${JSON.stringify(account)}, send: (receiver, acts) => new Promise((res) => { const id = Math.random().toString(36).slice(2); (window.__p ||= {})[id] = res; window.nodeSend(JSON.stringify({ id, receiver, acts })); }) };` });
  bindings.length = 0; await send("Page.navigate", { url: `${APP}?contract=${contract}${hash}` });
  for (let i = 0; i < 60 && !(await ev(`!!document.querySelector("#chain-actions .act")`)); i++) await sleep(500);
  pump();
}
let pumping = false;
async function pump() { if (pumping) return; pumping = true; for (;;) { while (bindings.length) { const b = bindings.shift(); const { id, receiver, acts } = JSON.parse(b.payload); const signer = await ev(`window.__testWallet.account`); let out; try { out = await execActs(signer, receiver, acts); } catch (e) { out = { status: { Failure: String(e.message) }, transaction: { hash: null } }; } await ev(`window.__p[${JSON.stringify(id)}](${JSON.stringify(out)})`); } await sleep(150); if (!pumping) return; } }
const toastText = async (re, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = await ev(`document.getElementById("toast")?.innerText ?? ""`); if (re.test(t)) return t; await sleep(500); } return await ev(`document.getElementById("toast")?.innerText ?? "(no toast)"`); };
const clickBtn = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);

try {
  await open();
  const core = acct("core", NEW), token = acct("usdc", NEW), efe = acct("efe", NEW);

  // 1. any wallet: register and get test USDC from the public faucet
  const before = BigInt(await view(token, "ft_balance_of", { account_id: efe }));
  await session(efe, core);
  check(!!(await ev(`document.getElementById("wallet-btn").textContent.includes("rounds-efe-052090")`)), "connected account shows in the nav");
  check(!!(await ev(`document.querySelector('#chain-actions [data-a="faucet"]')`)), "faucet button is offered");
  await clickBtn('#chain-actions [data-a="faucet"]');
  const t1 = await toastText(/DONE|FAIL/);
  check(/DONE/.test(t1), `faucet transaction succeeded (${t1.replace(/\s+/g, " ").slice(0, 90)})`);
  const after = BigInt(await view(token, "ft_balance_of", { account_id: efe }));
  check(after - before === 1_000_000_000n, `on-chain balance rose by exactly $1,000 (${before} -> ${after})`);

  // 2. a non-council account sees the board but cannot vote. Superseded deployment, so the open proposal below pollutes nothing current.
  const oldCore = acct("core", OLD), oldBoard = `rounds-board-${OLD}.sputnik-v2.testnet`;
  const prop = { proposal: { description: "wallet e2e test proposal (no effect)", kind: { FunctionCall: { receiver_id: oldCore, actions: [{ method_name: "set_officer", args: Buffer.from(JSON.stringify({ account: acct("efe", OLD), enabled: false })).toString("base64"), deposit: "0", gas: "60000000000000" }] } } } };
  const added = await signAndSend(acct("ada", OLD), oldBoard, { method: "add_proposal", args: JSON.stringify(prop), gasTgas: 100, depositYocto: "100000000000000000000000" });
  const pid = JSON.parse(Buffer.from(added.status.SuccessValue, "base64").toString());
  check(typeof pid === "number", `test proposal #${pid} created on the superseded board`);
  await session(acct("zed", OLD), oldCore);
  const dis = await ev(`document.querySelector('#chain-actions [data-a="vote"][data-p="${pid}"]')?.disabled`);
  check(dis === true, "a non-council account sees the proposal but its Approve button is disabled");

  // 3. council member votes through the UI; the DAO records it
  await session(acct("indep", OLD), oldCore);
  check((await ev(`document.querySelector('#chain-actions [data-a="vote"][data-p="${pid}"]')?.disabled`)) === false, "a council member's Approve button is enabled");
  await clickBtn(`#chain-actions [data-a="vote"][data-p="${pid}"]`);
  const t3 = await toastText(/DONE|FAIL/);
  check(/DONE/.test(t3), `vote transaction succeeded (${t3.replace(/\s+/g, " ").slice(0, 80)})`);
  const p = await view(oldBoard, "get_proposal", { id: pid });
  check(!!p.votes?.[acct("indep", OLD)], `DAO recorded the vote of ${acct("indep", OLD)} (status ${p.status})`);

  // 4. officer proposes the modeled round with the real button; the contract must accept the call's shape
  await session(acct("ada", OLD), oldCore);
  await ev(`document.getElementById("propose-btn").click()`);
  const t4 = await toastText(/DONE|FAIL/);
  console.log("     propose_round answer:", t4.replace(/\s+/g, " ").slice(0, 200));
  check(!/deserialize|hash|bad plan|plan_hash/i.test(t4) || /DONE/.test(t4), "propose_round arguments were accepted by the contract (no deserialize/hash error)");
  // 5. a non-officer is refused by the contract with its own message
  await session(efe, core);
  await ev(`document.getElementById("propose-btn").click()`);
  const t5 = await toastText(/DONE|FAIL/);
  check(/officer/i.test(t5), `non-officer propose_round is refused by the contract (${t5.replace(/\s+/g, " ").slice(0, 90)})`);
} catch (e) { check(false, `e2e aborted: ${e.message}`); }
pumping = false; try { ws.close(); } catch {} chrome.kill();
console.log(`${failed ? "FAIL" : "PASS"} summary: ${total} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
