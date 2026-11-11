// make e2e-share: drives the "Share a pot on testnet" card through the app's real buttons with the DEV-only test signer, on an open sandbox.
// It does NOT use up the sandbox (it never runs the Series A), but it does write testnet transactions and leaves one paid exit on it.
//   node scripts/e2e-share.mjs [app url] [sandbox rounds account]   (needs `make web-dev` running, the near CLI, Chrome, the sandbox's throwaway keys)
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const APP = process.argv[2] ?? "http://127.0.0.1:5173/";
const RPC = process.env.RPC_URL ?? "https://test.rpc.fastnear.com";
const pool = JSON.parse(readFileSync("web/public/sandboxes.json", "utf8"));
const ROUNDS = process.argv[3] ?? pool[pool.length - 1].rounds, SUFFIX = ROUNDS.replace("rsbx-rounds-", "").replace(".testnet", "");
const JUDGE = `rsbx-bayo-${SUFFIX}.testnet`; // a throwaway founder account whose key is on this machine
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0, total = 0; const check = (ok, msg) => { total++; if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };
async function rpc(method, params) { const j = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json(); if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200)); return j.result; }
const view = async (c, m, a) => JSON.parse(Buffer.from((await rpc("query", { request_type: "call_function", finality: "final", account_id: c, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString("base64") })).result).toString());
async function signAndSend(signer, receiver, act) {
  const args = ["contract", "call-function", "as-transaction", receiver, act.method, "json-args", act.args, "prepaid-gas", `${act.gasTgas} Tgas`, "attached-deposit", `${act.depositYocto} yoctoNEAR`, "sign-as", signer, "network-config", "testnet", "sign-with-legacy-keychain", "display"];
  const r = spawnSync("near", args, { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  const out = ((r.stderr ?? "") + (r.stdout ?? "")).replace(/\x1b\[[0-9;]*m/g, "");
  const b64 = out.match(/serialized as base64\):\s*\n(\S+)/)?.[1]; if (!b64) throw new Error("signing failed: " + out.slice(-300));
  return rpc("send_tx", { signed_tx_base64: b64, wait_until: "FINAL" });
}
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9337", "--window-size=1280,1000", `--user-data-dir=${mkdtempSync(join(tmpdir(), "e2e-share-"))}`, "about:blank"], { stdio: "ignore" });
let ws, mid = 0; const pend = new Map(); const bindings = [];
let t; for (let i = 0; i < 50; i++) { try { t = (await (await fetch("http://127.0.0.1:9337/json")).json()).find((x) => x.type === "page"); if (t) break; } catch {} await sleep(200); }
ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } else if (j.method === "Runtime.bindingCalled") bindings.push(j.params); };
const send = (method, params = {}) => new Promise((r) => { const i = ++mid; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };
(async () => { for (;;) { while (bindings.length) { const b = bindings.shift(); const { id, receiver, acts } = JSON.parse(b.payload); let out; try { let last; for (const a of acts) { last = await signAndSend(JUDGE, receiver, a); if (last.status?.Failure) break; } out = last; } catch (e) { out = { status: { Failure: String(e.message) }, transaction: { hash: null } }; } await ev(`window.__p[${JSON.stringify(id)}](${JSON.stringify(out)})`); } await sleep(150); } })();
const rowCls = (n) => ev(`document.querySelectorAll("#share-run-body .flow-row")[${n - 1}]?.className ?? ""`);
const waitRow = async (n, re, ms = 120000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await rowCls(n))) return true; await sleep(700); } return false; };
const press = async (act, n) => { for (let i = 0; i < 120 && !(await ev(`(()=>{const b=document.querySelector('#share-run-body [data-share="${act}"]');return !!b&&!b.disabled})()`)); i++) await sleep(500); await ev(`document.querySelector('#share-run-body [data-share="${act}"]').click()`); return waitRow(n, /done/); };

try {
  console.log(`sandbox ${ROUNDS}, signed in as ${JUDGE}`);
  await send("Page.enable"); await send("Runtime.enable"); await send("Runtime.addBinding", { name: "nodeSend" });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__testWallet = { account: ${JSON.stringify(JUDGE)}, send: (receiver, acts) => new Promise((res) => { const id = Math.random().toString(36).slice(2); (window.__p ||= {})[id] = res; window.nodeSend(JSON.stringify({ id, receiver, acts })); }) };` });
  const exits0 = (await view(ROUNDS, "exit", { exit_id: 1 })) ? 1 : 0; void exits0;
  const holdings = await view(ROUNDS, "cap_table", { from: 0, limit: 100 });
  await send("Page.navigate", { url: `${APP}?sandbox=${ROUNDS}` });
  for (let i = 0; i < 60 && !(await ev(`!!document.querySelector("#share-run-body .flow-row")`)); i++) await sleep(500);
  check((await ev(`document.getElementById("share-run").hidden`)) === false, "the run card is shown on a sandbox");
  check((await ev(`document.querySelectorAll("#share-run-body .flow-row").length`)) === 7, "all seven steps are on screen from the start");
  await ev(`(()=>{const s=document.getElementById("share-pot");s.value="10000";s.dispatchEvent(new Event("change"))})()`); await sleep(800);
  let prevRows = 0; for (let i = 0; i < 40 && prevRows < 3; i++) { prevRows = await ev(`document.querySelectorAll("#share-run-body .flow-result tr").length`); if (prevRows < 3) await sleep(500); }
  check(prevRows >= 3, `the payout preview lists this contract's shareholders before anything is sent (${prevRows - 1} rows)`);
  const h0 = await ev(`document.getElementById("share-run").offsetHeight`); let hMin = h0, hMax = h0; const parts = {};
  const sampler = setInterval(async () => { try { const h = await ev(`document.getElementById("share-run").offsetHeight`); hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
    const m = await ev(`JSON.stringify({banner:document.querySelector("#share-run-body .flow-banner")?.offsetHeight, ol:document.querySelector("#share-run-body ol")?.offsetHeight, result:document.querySelector("#share-run-body .flow-result")?.offsetHeight, rows:[...document.querySelectorAll("#share-run-body .flow-row")].map(r=>r.offsetHeight).join(",")})`); const o = JSON.parse(m);
    for (const [k, val] of Object.entries(o)) { (parts[k] ||= new Set()).add(val); } } catch {} }, 400);
  check(await waitRow(2, /current|done/, 30000), "step 2 (test USDC) is current or already done once the wallet is connected");
  check(await press("faucet", 2), "step 2: the judge gets test USDC");
  check(await press("officer", 3), "step 3: the open board makes the judge an officer");
  const n0 = (await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((i) => view(ROUNDS, "exit", { exit_id: i }).catch(() => null)))).filter(Boolean).length;
  check(await press("propose", 4), "step 4: the payout is proposed and the page finds its exit by the plan hash");
  const id = n0 + 1, ex = await view(ROUNDS, "exit", { exit_id: id });
  check(!!ex && !ex.approved && ex.payouts.length >= 1, `exit ${id} is on chain, not yet approved (${ex?.payouts.length} payouts, total ${ex?.total})`);
  check(await press("fund", 5), "step 5: the judge pays the pot into escrow");
  const funded = await view(ROUNDS, "exit", { exit_id: id });
  check(funded.funded === funded.total && JSON.stringify(funded.funders) === JSON.stringify([[JUDGE, funded.total]]), "the exit is funded exactly by the judge");
  check(await press("approve", 6), "step 6: the judge approves the plan hash as the open board");
  check(await press("pay", 7), "step 7: the judge runs distribute");
  let done; for (let i = 0; i < 40; i++) { done = await view(ROUNDS, "exit", { exit_id: id }); if (done.payouts.every((p) => p.state === "Paid")) break; await sleep(2000); }
  check(done.payouts.every((p) => p.state === "Paid"), "every payout is Paid on chain");
  // the amounts are the engine's pro rata split, worked out here independently from the chain's cap table
  const shares = {}; let eligible = 0n; for (const [h, , s] of holdings) if (h !== "unissued_pool") { shares[h] = (shares[h] ?? 0n) + BigInt(s); eligible += BigInt(s); }
  const pot = 10_000n * 1_000_000n; const exp = Object.keys(shares).sort().map((h) => [h, (pot * shares[h]) / eligible]).filter(([, a]) => a > 0n);
  check(JSON.stringify(exp.map(([h, a]) => [h, a.toString()])) === JSON.stringify(done.payouts.map((p) => [p.holder, p.amount])), "the payouts equal an independent pro-rata split of $10,000 over the chain's cap table, to the micro-dollar");
  check(await view(ROUNDS, "ledger_total", {}) === "0", "nothing is left in the contract's custody (ledger_total = 0)");
  check(/Done: every holder was paid once/.test(await ev(`document.querySelector("#share-run-body .flow-result").innerText`)), "the page itself says every holder was paid");
  clearInterval(sampler); console.log("     heights seen:", JSON.stringify(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, [...v]]))));
  check(hMax - hMin < 60, `the card's height stayed stable through the run (spread ${hMax - hMin}px)`);
} catch (e) { check(false, `run failed: ${e.message}`); }
console.log(`${failed ? "FAIL" : "PASS"} summary: ${total} checks, ${failed} failed`);
chrome.kill(); process.exit(failed ? 1 : 0);
