// e2e-zk: drives the Confidential mode (ZK) card and the Private Claim panel through the app's real buttons with the DEV-only test signer, on the
// confidential sandbox (web/public/zk-sandbox.json): the cap table is built and PROVED IN THE BROWSER, proposed, approved, closed, a private payout is
// opened, funded and approved, and a receipt is claimed to a brand-new account. Writes testnet transactions.
//   node scripts/e2e-zk.mjs [app url] [judge account with a key on this machine]
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const APP = process.argv[2] ?? "http://127.0.0.1:5173/";
const RPC = process.env.RPC_URL ?? "https://test.rpc.fastnear.com";
const ZK = JSON.parse(readFileSync("web/public/zk-sandbox.json", "utf8"));
const JUDGE = process.argv[3] ?? "rsbx-bayo-913009.testnet";
const ROUNDS = ZK.rounds, TOKEN = ZK.token;
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
const PORT = 9347;
const chrome = spawn("google-chrome", ["--headless=new", `--remote-debugging-port=${PORT}`, "--window-size=1280,1000", `--user-data-dir=${mkdtempSync(join(tmpdir(), "e2e-zk-"))}`, "about:blank"], { stdio: "ignore" });
let ws, mid = 0; const pend = new Map(); const bindings = [];
let t; for (let i = 0; i < 50; i++) { try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((x) => x.type === "page"); if (t) break; } catch {} await sleep(200); }
ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } else if (j.method === "Runtime.bindingCalled") bindings.push(j.params); else if (j.method === "Runtime.consoleAPICalled") { const t = j.params.args.map((a) => a.value ?? a.description ?? JSON.stringify(a.preview?.properties?.map((p) => `${p.name}=${p.value}`)) ?? "").join(" "); if (/\[zk\]/.test(t)) console.log("     page:", t.slice(0, 200)); } else if (j.method === "Runtime.exceptionThrown") console.log("     page exception:", JSON.stringify(j.params.exceptionDetails).slice(0, 300)); };
const send = (method, params = {}) => new Promise((r) => { const i = ++mid; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };
(async () => { for (;;) { while (bindings.length) { const b = bindings.shift(); const { id, receiver, acts } = JSON.parse(b.payload); let out; console.log(`     signer: ${acts.map((a) => a.method).join("+")} -> ${receiver.slice(0, 24)}`); try { let last; for (const a of acts) { last = await signAndSend(JUDGE, receiver, a); if (last.status?.Failure) break; } out = last; } catch (e) { out = { status: { Failure: String(e.message) }, transaction: { hash: null } }; } await ev(`window.__p[${JSON.stringify(id)}](${JSON.stringify(out)})`); } await sleep(150); } })();
const rowCls = (n) => ev(`document.querySelectorAll("#zk-run .flow-row")[${n - 1}]?.className ?? ""`);
const waitRow = async (n, re, ms = 300000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await rowCls(n))) return true; await sleep(800); } return false; };
const press = async (act, n) => { for (let i = 0; i < 200 && !(await ev(`(()=>{const b=document.querySelector('#zk-run [data-zk="${act}"]');return !!b&&!b.disabled})()`)); i++) await sleep(500); const t0 = Date.now(); await ev(`document.querySelector('#zk-run [data-zk="${act}"]').click()`); const ok = await waitRow(n, /done/, 150000); if (!ok) console.log("     toast at timeout:", (await ev(`document.getElementById("toast")?.innerText ?? ""`)).replace(/\s+/g, " ").slice(0, 400)); console.log(`     step ${n} (${act}) took ${((Date.now() - t0) / 1000).toFixed(1)} s`); return ok; };
// the panel re-draws after it has matched the receipt to its payout; wait for the claim button to be enabled before filling in the recipient
const waitBtn = async () => { for (let i = 0; i < 120; i++) { if (await ev(`(()=>{const b=document.getElementById("zk-claim-btn");const t=document.getElementById("zk-claim-body")?.innerText??"";return !!b&&!b.disabled&&/Receipt loaded/.test(t)})()`)) return; await sleep(1000); } console.log("     the claim button never became enabled:", (await ev(`document.getElementById("zk-claim-body")?.innerText ?? ""`)).replace(/\s+/g, " ").slice(0, 300)); };
const toastText = async (re, ms = 120000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const x = await ev(`document.getElementById("toast")?.innerText ?? ""`); if (re.test(x)) return x; await sleep(700); } return ""; };

try {
  console.log(`confidential sandbox ${ROUNDS}, signed in as ${JUDGE}`);
  await send("Page.enable"); await send("Runtime.enable"); await send("Runtime.addBinding", { name: "nodeSend" });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__testWallet = { account: ${JSON.stringify(JUDGE)}, send: (receiver, acts) => new Promise((res) => { const id = Math.random().toString(36).slice(2); (window.__p ||= {})[id] = res; window.nodeSend(JSON.stringify({ id, receiver, acts })); }) };` });
  await send("Page.navigate", { url: APP });
  for (let i = 0; i < 80 && !(await ev(`!!document.querySelector("#zk-run .flow-row")`)); i++) await sleep(500);
  check((await ev(`document.getElementById("zk").hidden`)) === false, "the Confidential mode section is shown when a confidential sandbox is configured");
  check((await ev(`document.querySelectorAll("#zk-run .flow-row").length`)) === 11, "all eleven steps are on screen from the start");
  const next0 = await view(ROUNDS, "next_round_id", {});
  check(await press("faucet", 2), "step 2: the judge gets test USDC");
  check(await press("officer", 3), "step 3: the open board makes the judge an officer");
  check(await press("propose", 4), "step 4: the cap table is built, PROVED in the browser, and the root is proposed");
  const round = await view(ROUNDS, "round", { round_id: next0 });
  const plan = JSON.parse(round.plan);
  check(round.kind === "Confidential" && plan.kind === "Confidential" && /^\d+$/.test(plan.merkle_root) && plan.total_shares === "13500000", `the round on chain carries only the root and the total (${plan.merkle_root.slice(0, 12)}…, ${plan.total_shares} shares)`);
  check(JSON.stringify(Object.keys(plan).sort()) === JSON.stringify(["deadline_ns", "kind", "merkle_root", "raise", "total_shares"]), "the plan on chain has no field that could carry a holding: only the root, the total, the raise and the deadline");
  const receipts = await ev(`JSON.stringify(window.__zkReceipts())`); const rc = JSON.parse(receipts);
  check(rc.length === 5 && rc.every((r) => r.merkleRoot === plan.merkle_root), "five receipts were generated in the tab, all pointing at the on-chain root");
  check(await press("fund", 5), "step 5: the judge funds the raise");
  check(await press("approve", 6), "step 6: the board approves the plan hash");
  check(await press("close", 7), "step 7: the round closes and the root is committed");
  const committed = await view(ROUNDS, "confidential_root", { round_id: next0 });
  check(committed && committed[0] === plan.merkle_root && committed[1] === "13500000", "the contract stores the committed root and total");
  check(await press("pexit", 8), "step 8: a private payout is opened");
  check(await press("pfund", 9), "step 9: the pot is funded");
  check(await press("papprove", 10), "step 10: the board approves the payout");
  // ---- a brand-new recipient account, registered with the test token
  const burner = `rsbx-zkburner-${Date.now().toString().slice(-7)}.testnet`;
  const mk = spawnSync("near", ["account", "create-account", "fund-myself", burner, "0.1 NEAR", "autogenerate-new-keypair", "save-to-legacy-keychain", "sign-as", JUDGE, "network-config", "testnet", "sign-with-legacy-keychain", "send"], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  check(mk.status === 0, `a fresh recipient account exists (${burner})`);
  await signAndSend(JUDGE, TOKEN, { method: "storage_deposit", args: JSON.stringify({ account_id: burner }), gasTgas: 30, depositYocto: "0" });
  // ---- the claim: the holder who is the judge, using the receipt file
  const mine = rc.find((r) => r.holderId === JUDGE);
  const exits = []; for (let i = 1; i < 10; i++) { const e = await view(ROUNDS, "private_exit", { exit_id: i }).catch(() => null); if (!e) break; exits.push(e); }
  const ex = exits[exits.length - 1], want = (BigInt(mine.shareAmount) * BigInt(ex.pot)) / BigInt(ex.total_shares);
  const before = BigInt(await view(TOKEN, "ft_balance_of", { account_id: burner }));
  await ev(`(()=>{const inp=document.getElementById("zk-file");const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(JSON.stringify(mine))}],"receipt.json",{type:"application/json"}));inp.files=dt.files;inp.dispatchEvent(new Event("change"))})()`);
  await waitBtn();
  await ev(`(()=>{const e=document.getElementById("zk-recipient");e.value=${JSON.stringify(burner)};e.dispatchEvent(new Event("input"))})()`);
  const t0 = Date.now();
  await ev(`(()=>{const t=document.getElementById("toast");if(t){t.style.display="none";t.innerText=""}})()`); // forget the previous step's toast
  await ev(`document.getElementById("zk-claim-btn").click()`);
  const tt = await toastText(/claimed to|FAIL/, 240000);
  console.log(`     claim (proof + transaction) took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  check(/DONE/.test(tt), `the private claim was proved in the browser and accepted (${tt.replace(/\s+/g, " ").slice(0, 90)})`);
  let after = before; for (let i = 0; i < 30 && after === before; i++) { await sleep(2000); after = BigInt(await view(TOKEN, "ft_balance_of", { account_id: burner })); }
  check(after - before === want, `the brand-new account received exactly the holder's pro-rata share (${want} micro-dollars)`);
  const nul = (await ev(`document.querySelector("#zk-claim-body")?.innerText ?? ""`)).length > 0;
  const ex2 = await view(ROUNDS, "private_exit", { exit_id: ex.id });
  check(BigInt(ex2.claimed) === want, "the contract's claimed total equals the one payout");
  // ---- replaying the same receipt is refused
  await sleep(15000); // let the panel finish re-reading the chain after the first claim, so a late redraw cannot clear what is typed next
  await ev(`(()=>{const inp=document.getElementById("zk-file");const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(JSON.stringify(mine))}],"receipt.json",{type:"application/json"}));inp.files=dt.files;inp.dispatchEvent(new Event("change"))})()`);
  await waitBtn();
  await ev(`(()=>{const e=document.getElementById("zk-recipient");e.value=${JSON.stringify(burner)};})()`);
  await ev(`(()=>{const t=document.getElementById("toast");if(t){t.style.display="none";t.innerText=""}})()`);
  await ev(`document.getElementById("zk-claim-btn").click()`);
  const tt2 = await toastText(/claimed to|FAIL/, 90000);
  if (!tt2) console.log("     no toast after the second claim; panel says:", (await ev(`document.getElementById("zk-claim-body")?.innerText ?? ""`)).replace(/\s+/g, " ").slice(0, 300));
  check(/FAIL/.test(tt2) && /ERR_NULLIFIER_USED/.test(tt2), `claiming the same receipt again is refused by the contract (${tt2.replace(/\s+/g, " ").slice(0, 100)})`);
  void nul;
} catch (e) { check(false, `run failed: ${e.message}`); }
console.log(`${failed ? "FAIL" : "PASS"} summary: ${total} checks, ${failed} failed`);
chrome.kill(); process.exit(failed ? 1 : 0);
