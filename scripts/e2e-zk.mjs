// e2e-zk: drives the Confidential mode (ZK) card and the Private Claim panel through the app's real buttons with the DEV-only test signer, on the
// confidential sandbox (web/public/zk-sandbox.json): the cap table is built and PROVED IN THE BROWSER, proposed, approved, closed, a private payout is
// opened, funded and approved, and a receipt is claimed to a brand-new account. Writes testnet transactions.
//   node scripts/e2e-zk.mjs [app url] [judge account with a key on this machine] [relayer account with a key and some NEAR]
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const APP = process.argv[2] ?? "http://127.0.0.1:5173/";
const RPC = process.env.RPC_URL ?? "https://test.rpc.fastnear.com";
const ZK = JSON.parse(readFileSync("web/public/zk-sandbox.json", "utf8"));
const JUDGE = process.argv[3] ?? "rsbx-bayo-913009.testnet";
const ROUNDS = ZK.rounds, TOKEN = ZK.token, RELAYER = process.argv[4] ?? "rsbx-ada-973123.testnet", signed = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0, total = 0; const check = (ok, msg) => { total++; if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };
async function rpc(method, params) { for (let i = 1; ; i++) { try { return await rpc1(method, params); } catch (e) { if (i >= 4 || !/fetch failed|timeout|ECONN|EAI_AGAIN/i.test(String(e.message ?? e))) throw e; await sleep(1500 * i); } } }
async function rpc1(method, params) { const j = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json(); if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200)); return j.result; }
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
(async () => { for (;;) { while (bindings.length) { const b = bindings.shift(); const { id, receiver, acts } = JSON.parse(b.payload); let out; signed.push(...acts.map((a) => a.method)); console.log(`     signer: ${acts.map((a) => a.method).join("+")} -> ${receiver.slice(0, 24)}`); try { let last; for (const a of acts) { last = await signAndSend(JUDGE, receiver, a); if (last.status?.Failure) break; } out = last; } catch (e) { out = { status: { Failure: String(e.message) }, transaction: { hash: null } }; } await ev(`window.__p[${JSON.stringify(id)}](${JSON.stringify(out)})`); } await sleep(150); } })();
const rowCls = (n) => ev(`document.querySelectorAll("#zk-run .flow-row")[${n - 1}]?.className ?? ""`);
const waitRow = async (n, re, ms = 300000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await rowCls(n))) return true; await sleep(800); } return false; };
const press = async (act, n) => { for (let i = 0; i < 200 && !(await ev(`(()=>{const b=document.querySelector('#zk-run [data-zk="${act}"]');return !!b&&!b.disabled})()`)); i++) await sleep(500); const t0 = Date.now(); await ev(`document.querySelector('#zk-run [data-zk="${act}"]').click()`); const ok = await waitRow(n, /done/, 150000); if (!ok) console.log("     toast at timeout:", (await ev(`document.getElementById("toast")?.innerText ?? ""`)).replace(/\s+/g, " ").slice(0, 400)); console.log(`     step ${n} (${act}) took ${((Date.now() - t0) / 1000).toFixed(1)} s`); return ok; };
const toastText = async (re, ms = 120000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const x = await ev(`document.getElementById("toast")?.innerText ?? ""`); if (re.test(x)) return x; await sleep(700); } return ""; };

const relayer = spawn("node", ["scripts/relayer.mjs"], { env: { ...process.env, RELAYER_ACCOUNT: RELAYER, RELAYER_CONTRACT: ROUNDS, RELAYER_CREDENTIALS: `${process.env.HOME}/.near-credentials/testnet/${RELAYER}.json`, PORT: "8791" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((res) => { relayer.stdout.on("data", (d) => { if (/relayer for/.test(String(d))) res(); }); setTimeout(res, 8000); });
const setFiles = (id, objs) => ev(`(()=>{const inp=document.getElementById(${JSON.stringify(id)});const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(JSON.stringify(objs))}],"f.json",{type:"application/json"}));inp.files=dt.files;inp.dispatchEvent(new Event("change"))})()`);
const waitBtn = async () => { for (let i = 0; i < 120; i++) { if (await ev(`(()=>{const b=document.getElementById("zk-claim-btn");const t=document.getElementById("zk-claim-body")?.innerText??"";return !!b&&!b.disabled&&/Claim file:/.test(t)&&/Holder key loaded/.test(t)})()`)) return; await sleep(1000); } console.log("     the claim button never became enabled:", (await ev(`document.getElementById("zk-claim-body")?.innerText ?? ""`)).replace(/\s+/g, " ").slice(0, 300)); };
const clearToast = () => ev(`(()=>{const t=document.getElementById("toast");if(t){t.style.display="none";t.innerText=""}})()`);
const sha256 = async (str) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)))].map((x) => x.toString(16).padStart(2, "0")).join("");

try {
  console.log(`confidential sandbox ${ROUNDS}, holder ${JUDGE}, relayer ${RELAYER}`);
  await send("Page.enable"); await send("Runtime.enable"); await send("Runtime.addBinding", { name: "nodeSend" });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__testWallet = { account: ${JSON.stringify(JUDGE)}, send: (receiver, acts) => new Promise((res) => { const id = Math.random().toString(36).slice(2); (window.__p ||= {})[id] = res; window.nodeSend(JSON.stringify({ id, receiver, acts })); }) };` });
  await send("Page.navigate", { url: `${APP}?relayer=${encodeURIComponent("http://127.0.0.1:8791/relay-claim")}` });
  for (let i = 0; i < 80 && !(await ev(`!!document.querySelector("#zk-run .flow-row")`)); i++) await sleep(500);
  check((await ev(`document.getElementById("zk").hidden`)) === false, "the Confidential mode section is shown when a confidential sandbox is configured");
  check((await ev(`document.querySelectorAll("#zk-run .flow-row").length`)) === 10, "all ten steps are on screen from the start");
  const next0 = await view(ROUNDS, "next_round_id", {});
  check(await press("faucet", 2), "step 2: the judge gets test USDC");
  check(await press("officer", 3), "step 3: the open board makes the judge an officer");
  const PASS = "a board passphrase 2026";
  await ev(`(()=>{const e=document.getElementById("zk-pass");e.value=${JSON.stringify(PASS)};e.dispatchEvent(new Event("input"))})()`);
  check(await press("propose", 4), "step 4: the cap table is built, PROVED in the browser, an encrypted board copy is made, and the root is proposed");
  const round = await view(ROUNDS, "round", { round_id: next0 });
  const plan = JSON.parse(round.plan);
  check(round.kind === "Confidential" && JSON.stringify(Object.keys(plan).sort()) === JSON.stringify(["deadline_ns", "escrow_hash", "kind", "merkle_root", "raise", "total_shares"]), "the plan on chain has no field that could carry a holding: the root, the total, the raise, the deadline and the escrow commitment");
  const built = JSON.parse(await ev(`JSON.stringify(window.__zkBuilt, (k, v) => typeof v === "bigint" ? v.toString() : v)`));
  check(built.tableFile.merkleRoot === plan.merkle_root, `the files the page holds belong to the round on chain (root ${built.tableFile.merkleRoot.slice(0, 10)}… vs ${plan.merkle_root.slice(0, 10)}…)`);
  const escrowCanon = JSON.stringify({ ciphertext: built.escrow.ciphertext, iterations: built.escrow.iterations, iv: built.escrow.iv, kdf: built.escrow.kdf, salt: built.escrow.salt, version: built.escrow.version });
  check(plan.escrow_hash === (await sha256(escrowCanon)), "the encrypted board copy's hash is committed inside the plan the board approves");
  check(!JSON.stringify(built.claimFiles).includes(built.keys[0].holderSecret) && !JSON.stringify(built.tableFile).includes(built.keys[0].holderSecret), "no claim file and no table file contains a holder's secret key");
  // ---- the board's check, in the page: the encrypted copy, a wrong passphrase, a tampered table
  // the Board check lists the rounds it read when the page loaded: reload, then pick the new round
  for (let i = 0; i < 40 && !(await ev(`!![...document.querySelectorAll("#zk-bround option")].find((o) => o.value === "${next0}")`)); i++) { await ev(`document.getElementById("zk-breload").click()`); await sleep(3000); }
  await ev(`document.getElementById("zk-bround").value="${next0}";document.getElementById("zk-bround").dispatchEvent(new Event("change"))`);
  await setFiles("zk-btable", built.escrow);
  await ev(`(()=>{const e=document.getElementById("zk-bpass");e.value=${JSON.stringify(PASS)}})()`);
  await ev(`document.getElementById("zk-bcheck").click()`);
  for (let i = 0; i < 90 && !/re-seals/.test(await ev(`document.getElementById("zk-bout")?.textContent ?? ""`)); i++) await sleep(1000);
  const bo = await ev(`document.getElementById("zk-bout")?.textContent ?? ""`);
  console.log("     board out:", JSON.stringify(bo.slice(0, 400)));
  check(/PASS this encrypted copy is exactly the one the proposer committed/.test(bo) && /PASS the table re-seals to exactly the root on chain/.test(bo), "Board check: the encrypted copy matches the committed hash and re-seals to the on-chain root");
  const tampered = { ...built.tableFile, entries: built.tableFile.entries.map((e, i) => (i === 0 ? { ...e, shares: String(BigInt(e.shares) + 1n) } : e)) };
  await setFiles("zk-btable", tampered);
  await ev(`document.getElementById("zk-bcheck").click()`);
  for (let i = 0; i < 90 && !/DIFFERENT root/.test(await ev(`document.getElementById("zk-bout")?.textContent ?? ""`)); i++) await sleep(1000);
  check(/FAIL the table hashes to a DIFFERENT root/.test(await ev(`document.getElementById("zk-bout")?.textContent ?? ""`)), "Board check: a table with one number changed is refused");
  await setFiles("zk-btable", built.escrow); await ev(`document.getElementById("zk-bpass").value="the wrong passphrase!!"`); await ev(`document.getElementById("zk-bcheck").click()`);
  for (let i = 0; i < 60 && !/wrong passphrase/.test(await ev(`document.getElementById("zk-bout")?.textContent ?? ""`)); i++) await sleep(1000);
  check(/wrong passphrase/.test(await ev(`document.getElementById("zk-bout")?.textContent ?? ""`)), "Board check: the wrong passphrase does not open the encrypted copy");
  check(await press("fund", 5), "step 5: the judge funds the raise");
  check(await press("approve", 6), "step 6: the board approves the plan hash");
  check(await press("close", 7), "step 7: the round closes and the root is committed");
  check(await press("pexit", 8), "step 8: a private payout is opened");
  check(await press("pfund", 9), "step 9: the pot is funded");
  check(await press("papprove", 10), "step 10: the board approves the payout");
  // ---- a brand-new recipient account that is NOT registered with the token: the contract registers it
  const burner = `rsbx-zkburner-${Date.now().toString().slice(-7)}.testnet`;
  const mk = spawnSync("near", ["account", "create-account", "fund-myself", burner, "0.1 NEAR", "autogenerate-new-keypair", "save-to-legacy-keychain", "sign-as", JUDGE, "network-config", "testnet", "sign-with-legacy-keychain", "send"], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  check(mk.status === 0, `a fresh recipient account exists and is NOT registered with the token (${burner})`);
  // ---- the holder claims with their own key and claim file, through the relayer
  const idx = built.claimFiles.findIndex((c) => c.holderId === JUDGE);
  console.log("     claim files:", built.claimFiles.map((c, i) => `${i}:${c.holderId.slice(0, 22)}:${c.shareAmount}`).join(" | "), "-> using index", idx);
  const exits = []; for (let i = 1; i < 40; i++) { const e = await view(ROUNDS, "private_exit", { exit_id: i }).catch(() => null); if (!e) break; exits.push(e); }
  const ex = exits[exits.length - 1], want = (BigInt(built.claimFiles[idx].shareAmount) * BigInt(ex.pot)) / BigInt(ex.total_shares);
  const before = BigInt(await view(TOKEN, "ft_balance_of", { account_id: burner }));
  const signedBefore = signed.length;
  await setFiles("zk-file", built.claimFiles[idx]); await setFiles("zk-keyfile", built.keys[idx]); // the whole lists, as the demo downloads them: the page picks the connected holder's entry and its matching key
  await waitBtn();
  await ev(`(()=>{const e=document.getElementById("zk-recipient");e.value=${JSON.stringify(burner)};e.dispatchEvent(new Event("input"))})()`);
  check(await ev(`!!document.getElementById("zk-relay") && document.getElementById("zk-relay").checked`), "the relayer option is offered and on by default");
  console.log("     claim panel says:", (await ev(`document.getElementById("zk-claim-body")?.innerText ?? ""`)).replace(/\s+/g, " ").slice(-170));
  const t0 = Date.now(); await clearToast();
  await ev(`document.getElementById("zk-claim-btn").click()`);
  const tt = await toastText(/claimed to|FAIL/, 240000);
  console.log(`     claim (proof + relayer) took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  check(/DONE/.test(tt) && /submitted by the relayer/.test(tt), `the private claim was proved in the browser and submitted by the relayer (${tt.replace(/\s+/g, " ").slice(0, 110)})`);
  check(!signed.slice(signedBefore).includes("claim_private_payout"), "the holder's wallet signed nothing for the claim: the relayer paid and submitted it");
  let after = before; for (let i = 0; i < 30 && after === before; i++) { await sleep(2000); after = BigInt(await view(TOKEN, "ft_balance_of", { account_id: burner })); }
  check(after - before === want, `the unregistered account was registered by the contract and received exactly the holder's pro-rata share (${want} micro-dollars)`);
  check(BigInt((await view(ROUNDS, "private_exit", { exit_id: ex.id })).claimed) === want, "the contract's claimed total equals the one payout");
  // ---- replaying the same claim is refused (here by the relayer, which checks the nullifier before spending gas)
  await sleep(10000);
  await setFiles("zk-file", built.claimFiles[idx]); await setFiles("zk-keyfile", built.keys[idx]); await waitBtn();
  await ev(`(()=>{const e=document.getElementById("zk-recipient");e.value=${JSON.stringify(burner)}})()`);
  await clearToast(); await ev(`document.getElementById("zk-claim-btn").click()`);
  const tt2 = await toastText(/claimed to|FAIL/, 120000);
  check(/FAIL/.test(tt2) && /ERR_NULLIFIER_USED/.test(tt2), `claiming the same receipt again is refused (${tt2.replace(/\s+/g, " ").slice(0, 100)})`);
} catch (e) { check(false, `run failed: ${e.message}`); }
console.log(`${failed ? "FAIL" : "PASS"} summary: ${total} checks, ${failed} failed`);
relayer.kill(); chrome.kill(); process.exit(failed ? 1 : 0);
