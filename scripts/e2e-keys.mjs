// e2e-keys: the wallet-derived keys, sealed data and relayer fee of Confidential mode, through the app's real buttons with the DEV-only test signer
// (which also signs NEP-413 messages with the judge account's key), on the confidential sandbox (web/public/zk-sandbox.json). It checks that
//   - the holder's key is derived from the wallet (no key file is ever loaded), its claim is sealed on chain, and the table is sealed for the board;
//   - the board member's wallet opens the table and "Table matches the on-chain root" appears;
//   - after the browser's session storage is wiped, "Recover my claim with my wallet" finds the claim and key again, and the claim (through a relayer, to a
//     brand-new account) pays the share minus the board-set relayer fee, the fee going to the relayer.
// Writes testnet transactions on the sandbox.   node scripts/e2e-keys.mjs [app url] [judge account with a key here] [relayer account with a key and some NEAR]
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 as nsha } from "@noble/hashes/sha2.js";
import * as bs58 from "@scure/base";
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
const PORT = 9348;
const u32 = (n) => Buffer.from([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const bstr = (s) => { const b = Buffer.from(s); return Buffer.concat([u32(b.length), b]); };
// the judge's key from ~/.near-credentials, signing like a NEP-413 wallet: ed25519 over sha256(u32le(2^31+413) ++ borsh(payload))
function signNep413(m) {
  const cred = JSON.parse(readFileSync(`${process.env.HOME}/.near-credentials/testnet/${JUDGE}.json`, "utf8"));
  const { base58 } = bs58; const sk = base58.decode(cred.private_key.replace("ed25519:", "")).slice(0, 32);
  const hash = nsha(Buffer.concat([u32(2147484061), bstr(m.message), Buffer.from(m.nonce, "base64"), bstr(m.recipient), Buffer.from([0])]));
  return { accountId: JUDGE, publicKey: cred.public_key, signature: Buffer.from(ed25519.sign(hash, sk)).toString("base64") };
}
const chrome = spawn("google-chrome", ["--headless=new", `--remote-debugging-port=${PORT}`, "--window-size=1280,1000", `--user-data-dir=${mkdtempSync(join(tmpdir(), "e2e-zk-"))}`, "about:blank"], { stdio: "ignore" });
let ws, mid = 0; const pend = new Map(); const bindings = [];
let t; for (let i = 0; i < 50; i++) { try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((x) => x.type === "page"); if (t) break; } catch {} await sleep(200); }
ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } else if (j.method === "Runtime.bindingCalled") bindings.push(j.params); else if (j.method === "Runtime.consoleAPICalled") { const t = j.params.args.map((a) => a.value ?? a.description ?? JSON.stringify(a.preview?.properties?.map((p) => `${p.name}=${p.value}`)) ?? "").join(" "); if (/\[zk\]/.test(t)) console.log("     page:", t.slice(0, 200)); } else if (j.method === "Runtime.exceptionThrown") console.log("     page exception:", JSON.stringify(j.params.exceptionDetails).slice(0, 300)); };
const send = (method, params = {}) => new Promise((r) => { const i = ++mid; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };
(async () => { for (;;) { while (bindings.length) { const b = bindings.shift(); const msg0 = JSON.parse(b.payload); if (msg0.kind === 'sign') { await ev(`window.__p[${JSON.stringify(msg0.id)}](${JSON.stringify(signNep413(msg0))})`); continue; } const { id, receiver, acts } = msg0; let out; signed.push(...acts.map((a) => a.method)); console.log(`     signer: ${acts.map((a) => a.method).join("+")} -> ${receiver.slice(0, 24)}`); try { let last; for (const a of acts) { last = await signAndSend(JUDGE, receiver, a); if (last.status?.Failure) break; } out = last; } catch (e) { out = { status: { Failure: String(e.message) }, transaction: { hash: null } }; } await ev(`window.__p[${JSON.stringify(id)}](${JSON.stringify(out)})`); } await sleep(150); } })();
const rowCls = (n) => ev(`document.querySelectorAll("#zk-run .flow-row")[${n - 1}]?.className ?? ""`);
const waitRow = async (n, re, ms = 300000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await rowCls(n))) return true; await sleep(800); } return false; };
const press = async (act, n) => { for (let i = 0; i < 200 && !(await ev(`(()=>{const b=document.querySelector('#zk-run [data-zk="${act}"]');return !!b&&!b.disabled})()`)); i++) await sleep(500); const t0 = Date.now(); await ev(`document.querySelector('#zk-run [data-zk="${act}"]').click()`); const ok = await waitRow(n, /done/, 150000); if (!ok) console.log("     toast at timeout:", (await ev(`document.getElementById("toast")?.innerText ?? ""`)).replace(/\s+/g, " ").slice(0, 400)); console.log(`     step ${n} (${act}) took ${((Date.now() - t0) / 1000).toFixed(1)} s`); return ok; };
const toastText = async (re, ms = 120000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const x = await ev(`document.getElementById("toast")?.innerText ?? ""`); if (re.test(x)) return x; await sleep(700); } return ""; };

const relayer = spawn("node", ["scripts/relayer.mjs"], { env: { ...process.env, RELAYER_ACCOUNT: RELAYER, RELAYER_CONTRACT: ROUNDS, RELAYER_CREDENTIALS: `${process.env.HOME}/.near-credentials/testnet/${RELAYER}.json`, PORT: "8792" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((res) => { relayer.stdout.on("data", (d) => { if (/relayer for/.test(String(d))) res(); }); setTimeout(res, 8000); });
const setFiles = (id, objs) => ev(`(()=>{const inp=document.getElementById(${JSON.stringify(id)});const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(JSON.stringify(objs))}],"f.json",{type:"application/json"}));inp.files=dt.files;inp.dispatchEvent(new Event("change"))})()`);
const waitBtn = async () => { for (let i = 0; i < 120; i++) { if (await ev(`(()=>{const b=document.getElementById("zk-claim-btn");const t=document.getElementById("zk-claim-body")?.innerText??"";return !!b&&!b.disabled&&/Claim file:/.test(t)&&/Holder key loaded/.test(t)})()`)) return; await sleep(1000); } console.log("     the claim button never became enabled:", (await ev(`document.getElementById("zk-claim-body")?.innerText ?? ""`)).replace(/\s+/g, " ").slice(0, 300)); };
const clearToast = () => ev(`(()=>{const t=document.getElementById("toast");if(t){t.style.display="none";t.innerText=""}})()`);
const sha256 = async (str) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)))].map((x) => x.toString(16).padStart(2, "0")).join("");

const FEE = 5n * 1_000_000n;
const waitText = async (id, re, ms = 120000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const x = await ev(`document.getElementById(${JSON.stringify(id)})?.textContent ?? ""`); if (re.test(x)) return x; await sleep(800); } return ""; };
const setVal = (id, v, evs = ["input", "change"]) => ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(v)};${evs.map((x) => `e.dispatchEvent(new Event(${JSON.stringify(x)}))`).join(";")}})()`);
const load = async () => { await send("Page.navigate", { url: `${APP}?relayer=${encodeURIComponent("http://127.0.0.1:8792/relay-claim")}` }); for (let i = 0; i < 80 && !(await ev(`!!document.querySelector("#zk-run .flow-row")`)); i++) await sleep(500); };
try {
  console.log(`confidential sandbox ${ROUNDS}, holder ${JUDGE}, relayer ${RELAYER}`);
  await send("Page.enable"); await send("Runtime.enable"); await send("Runtime.addBinding", { name: "nodeSend" });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__testWallet = { account: ${JSON.stringify(JUDGE)},
    send: (receiver, acts) => new Promise((res) => { const id = Math.random().toString(36).slice(2); (window.__p ||= {})[id] = res; window.nodeSend(JSON.stringify({ id, receiver, acts })); }),
    signMessage: (message, recipient, nonce) => new Promise((res) => { const id = Math.random().toString(36).slice(2); (window.__p ||= {})[id] = res; window.nodeSend(JSON.stringify({ kind: "sign", id, message, recipient, nonce: btoa(String.fromCharCode(...nonce)) })); }) };` });
  await load();
  const next0 = await view(ROUNDS, "next_round_id", {});
  check(await press("faucet", 2), "step 2: the judge gets test USDC");
  check(await press("officer", 3), "step 3: the open board makes the judge an officer");
  // ---- the board member publishes an encryption key derived from the wallet (the judge plays the board member here)
  await setVal("zk-members", JUDGE);
  await clearToast(); await ev(`document.getElementById("zk-regkey").click()`);
  const rk = await toastText(/DONE|FAIL/, 120000);
  check(/DONE/.test(rk), `the board member's wallet derives an encryption key and publishes it on chain (${rk.replace(/\s+/g, " ").slice(0, 80)})`);
  let ek = null; for (let i = 0; i < 20 && !ek; i++) { ek = await view(ROUNDS, "enc_key_of", { account: JUDGE }).catch(() => null); if (!ek) await sleep(2000); }
  check(/^[0-9a-f]{64}$/.test(ek ?? ""), "the contract's key registry holds a 32-byte public key for the member (and no secret can be in it)");
  // ---- propose: the holder key comes from the wallet, the claim and the table are sealed on chain
  await setVal("zk-members", JUDGE, ["input", "change"]);
  await sleep(4000);
  check(/ready/.test(await ev(`document.getElementById("zk-memstat")?.textContent ?? ""`)), "the page shows the member as ready (key found on chain)");
  await clearToast();
  check(await press("propose", 4), "step 4: the table is built with the wallet-derived holder key, PROVED in the browser, and proposed with the sealed data posted in the same go");
  const round = await view(ROUNDS, "round", { round_id: next0 }); const plan = JSON.parse(round.plan);
  check(/^[0-9a-f]{64}$/.test(plan.escrow_hash ?? ""), "the plan commits to the sealed board copy by hash");
  for (let i = 0; i < 30 && !(await view(ROUNDS, "claim_blobs_published", { round_id: next0 })); i++) await sleep(2000);
  check(await view(ROUNDS, "claim_blobs_published", { round_id: next0 }) === true, "the holder's sealed claim was posted on chain (no claim file needed later)");
  const env = await view(ROUNDS, "board_envelope", { round_id: next0 });
  check(!!env && JSON.parse(env).wraps.some((w) => w.id === JUDGE) && !/shares|holderCode|Series A/.test(env), "the sealed board copy is on chain, wrapped for the board member, and is ciphertext (no holding is readable in it)");
  const built = JSON.parse(await ev(`JSON.stringify(window.__zkBuilt, (k, v) => typeof v === "bigint" ? v.toString() : v)`));
  const idx = built.claimFiles.findIndex((c) => c.holderId === JUDGE);
  check(idx >= 0, "the judge has a row in the private table");
  // ---- the board member's wallet opens the table: no file, no passphrase
  for (let i = 0; i < 40 && !(await ev(`!![...document.querySelectorAll("#zk-bround option")].find((o) => o.value === "${next0}")`)); i++) { await ev(`document.getElementById("zk-breload").click()`); await sleep(3000); }
  await ev(`document.getElementById("zk-bround").value="${next0}";document.getElementById("zk-bround").dispatchEvent(new Event("change"))`);
  for (let i = 0; i < 30 && (await ev(`document.getElementById("zk-bwallet")?.disabled`)); i++) { await ev(`document.getElementById("zk-breload").click()`); await sleep(3000); await ev(`document.getElementById("zk-bround").value="${next0}";document.getElementById("zk-bround").dispatchEvent(new Event("change"))`); }
  await ev(`document.getElementById("zk-bwallet").click()`);
  const bo = await waitText("zk-bout", /Table matches the on-chain root|FAIL/, 120000);
  console.log("     board out:", JSON.stringify(bo.slice(0, 300)));
  check(/PASS the board copy on chain is exactly the one the round committed to/.test(bo) && /Table matches the on-chain root/.test(bo), "Decrypt & verify: the wallet opens the sealed table and it re-seals to the on-chain root");
  check(await press("fund", 5), "step 5: the judge funds the raise");
  check(await press("approve", 6), "step 6: the board approves the plan hash");
  check(await press("close", 7), "step 7: the round closes");
  check(await press("pexit", 8), "step 8: a private payout is opened");
  check(await press("pfund", 9), "step 9: the pot is funded");
  await ev(`(()=>{const e=document.getElementById("zk-fee");e.value="5";e.dispatchEvent(new Event("change"))})()`);
  check(await press("papprove", 10), "step 10: the board sets a $5 relayer fee and approves the payout");
  check(BigInt(await view(ROUNDS, "claim_fee", {})) === FEE, "the contract's relayer fee is the $5 the board set");
  // ---- a fresh browser: nothing in session storage, no files
  const burner = `rsbx-zkburner-${Date.now().toString().slice(-7)}.testnet`;
  const mk = spawnSync("near", ["account", "create-account", "fund-myself", burner, "0.1 NEAR", "autogenerate-new-keypair", "save-to-legacy-keychain", "sign-as", JUDGE, "network-config", "testnet", "sign-with-legacy-keychain", "send"], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  check(mk.status === 0, `a fresh recipient account exists and is NOT registered with the token (${burner})`);
  await ev(`sessionStorage.clear()`); await load();
  check((await ev(`window.__zkBuilt ?? null`)) === null, "after wiping the browser's session storage the page holds no key and no claim file");
  const exits = []; for (let i = 1; i < 40; i++) { const e = await view(ROUNDS, "private_exit", { exit_id: i }).catch(() => null); if (!e) break; exits.push(e); }
  const ex = exits[exits.length - 1], want = (BigInt(built.claimFiles[idx].shareAmount) * BigInt(ex.pot)) / BigInt(ex.total_shares);
  const before = BigInt(await view(TOKEN, "ft_balance_of", { account_id: burner })), relBefore = BigInt(await view(TOKEN, "ft_balance_of", { account_id: RELAYER }));
  const signedBefore = signed.length;
  await clearToast(); await ev(`document.getElementById("zk-recover").click()`);
  const rec = await waitText("zk-claim-body", /Recovered \d+ claim file|FAIL/, 120000);
  check(/Recovered \d+ claim file/.test(rec) && /derived from your wallet|holder key from your wallet/.test(rec), `"Recover my claim with my wallet" finds the sealed claim(s) and re-derives the holder key, no file loaded (${rec.replace(/\s+/g, " ").slice(-130)})`);
  await waitBtn();
  await setVal("zk-recipient", burner, ["input"]);
  check(/after its \$5\.00 fee|relayer fee \$5/.test(await ev(`document.getElementById("zk-claim-body")?.innerText ?? ""`)), "the panel says what the holder receives after the relayer fee");
  const t0 = Date.now(); await clearToast(); await ev(`document.getElementById("zk-claim-btn").click()`);
  const tt = await toastText(/claimed to|FAIL/, 240000);
  console.log(`     claim (proof + relayer) took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  check(/DONE/.test(tt) && /submitted by the relayer/.test(tt), `the claim was proved in the browser with the recovered key and submitted by the relayer (${tt.replace(/\s+/g, " ").slice(0, 110)})`);
  check(!signed.slice(signedBefore).includes("claim_private_payout"), "the holder's wallet signed no claim transaction");
  let after = before; for (let i = 0; i < 30 && after === before; i++) { await sleep(2000); after = BigInt(await view(TOKEN, "ft_balance_of", { account_id: burner })); }
  check(after - before === want - FEE, `the fresh account received the pro-rata share minus the $5 fee (${want - FEE} of ${want} micro-dollars)`);
  let relAfter = relBefore; for (let i = 0; i < 20 && relAfter === relBefore; i++) { await sleep(2000); relAfter = BigInt(await view(TOKEN, "ft_balance_of", { account_id: RELAYER })); }
  check(relAfter - relBefore === FEE, "the relayer received exactly the fee");
  check(BigInt((await view(ROUNDS, "private_exit", { exit_id: ex.id })).claimed) === want, "the contract's claimed total is the whole payout (holder plus fee)");
  await sleep(8000); await clearToast(); await setVal("zk-recipient", burner, ["input"]); await ev(`document.getElementById("zk-claim-btn").click()`);
  const tt2 = await toastText(/claimed to|FAIL/, 120000);
  check(/FAIL/.test(tt2) && /ERR_NULLIFIER_USED/.test(tt2), `claiming again is refused (${tt2.replace(/\s+/g, " ").slice(0, 100)})`);
} catch (e) { check(false, `run failed: ${e.message}`); }
console.log(`${failed ? "FAIL" : "PASS"} summary: ${total} checks, ${failed} failed`);
relayer.kill(); chrome.kill(); process.exit(failed ? 1 : 0);
