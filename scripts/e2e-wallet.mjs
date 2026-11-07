// End-to-end check of the app's wallet buttons against NEAR testnet, using throwaway demo accounts whose keys are in
// ~/.near-credentials (never in the repo). The app (vite dev server, DEV only) is given a test signer instead of a wallet
// popup; everything else (button logic, the transactions it builds, the contract's answers) is the real thing.
//   node scripts/e2e-wallet.mjs [app url]      (needs `make web-dev` running, the near CLI, Chrome)
//   E2E_SANDBOX=path/to/sandbox-instance.json also plays the whole judge path on that (throwaway) sandbox instance.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
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
const clickBtn = async (sel) => { for (let i = 0; i < 90 && !(await ev(`!!document.querySelector(${JSON.stringify(sel)}) && !document.querySelector(${JSON.stringify(sel)}).disabled`)); i++) await sleep(500); return ev(`document.querySelector(${JSON.stringify(sel)}).click()`); };

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
  check(after - before === 10_000_000_000_000n, `on-chain balance rose by exactly $10,000,000 of test USDC (${before} -> ${after})`);

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

  // 6. the judge path on the OPEN SANDBOX through the guided "Run a round on testnet" steps only. The page must also keep a stable
  //    height while chain data refreshes after each step (the layout used to grow and shrink).
  if (process.env.E2E_SANDBOX && existsSync(process.env.E2E_SANDBOX)) { // the flow closes this sandbox's Series A: never point it at the sandbox judges use
    const sb = JSON.parse(readFileSync(process.env.E2E_SANDBOX, "utf8")); const judge = sb.accounts.bayo, rounds = sb.accounts.rounds, stoken = sb.accounts.usdc;
    const pool = await (await fetch(new URL("sandboxes.json", APP))).json();
    const firstUnused = [...pool].find((c) => c.rounds === rounds);
    check(!!firstUnused && pool.find((c) => !c.skip)?.rounds !== undefined, `the served pool contains the sandbox under test (${rounds})`);
    const waitFor = async (fn, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch {} await sleep(1500); } return null; };
    const flowBtn = (a) => `#flow [data-flow="${a}"]`;
    const rowState = (n) => ev(`document.querySelectorAll("#flow .flow-row")[${n - 1}]?.className ?? ""`);
    await send("Page.enable"); await send("Runtime.enable"); await send("Runtime.addBinding", { name: "nodeSend" });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__testWallet = { account: ${JSON.stringify(judge)}, send: (receiver, acts) => new Promise((res) => { const id = Math.random().toString(36).slice(2); (window.__p ||= {})[id] = res; window.nodeSend(JSON.stringify({ id, receiver, acts })); }) };` });
    bindings.length = 0; await send("Page.navigate", { url: APP });
    for (let i = 0; i < 60 && !(await ev(`document.querySelectorAll("#flow .flow-row").length === 8`)); i++) await sleep(500);
    pump();
    check(!!(await ev(`!document.getElementById("try").hidden`)), "the guided section is shown when a sandbox is configured");
    check((await ev(`document.querySelectorAll("#flow .flow-row").length`)) === 8, "all eight steps are on screen from the start");
    const heights = []; let sampling = true; (async () => { while (sampling) { try { heights.push(await ev(`document.getElementById("flow").offsetHeight`)); } catch {} await sleep(200); } })();
    const before6 = BigInt(await view(stoken, "ft_balance_of", { account_id: judge }));
    for (let i = 0; i < 60 && !/current/.test(await rowState(2)); i++) await sleep(500); // the first chain read is asynchronous
    check(/current/.test(await rowState(2)), "step 2 (test USDC) is the current step once the wallet is connected");
    await clickBtn(flowBtn("faucet")); check(/DONE/.test(await toastText(/DONE|FAIL/)), "step 2: judge gets test USDC");
    check(BigInt(await view(stoken, "ft_balance_of", { account_id: judge })) - before6 === 10_000_000_000_000n, "step 2: token balance rose by $10,000,000");
    for (let i = 0; i < 40 && !/done/.test(await rowState(2)); i++) await sleep(500);
    check(/done/.test(await rowState(2)) && /current/.test(await rowState(3)), "step 2 turns done and step 3 becomes current by itself");
    await clickBtn(flowBtn("officer")); check(/DONE/.test(await toastText(/DONE|FAIL/)), "step 3: the open board makes the judge an officer");
    for (let i = 0; i < 40 && !/current/.test(await rowState(5)); i++) await sleep(500);
    await clickBtn(flowBtn("propose")); const tp = await toastText(/DONE|FAIL/);
    check(/DONE/.test(tp), `step 5: the modeled Series A is proposed (${tp.replace(/\s+/g, " ").slice(0, 60)})`);
    check(!!(await waitFor(async () => (await view(rounds, "round", { round_id: 4 }))?.status === "Funding")), "step 5: round 4 is Funding on chain");
    await clickBtn(flowBtn("deposit")); check(/DONE/.test(await toastText(/DONE|FAIL/)), "step 6: the judge funds the round");
    check(!!(await waitFor(async () => { const r = await view(rounds, "round", { round_id: 4 }); return r.deposits?.[0]?.[1] === r.raise[0][1]; })), "step 6: the contract credited the full deposit");
    await clickBtn(flowBtn("approve")); check(/DONE/.test(await toastText(/DONE|FAIL/)), "step 7: the judge approves round 4 as the board");
    check(!!(await waitFor(async () => (await view(rounds, "round", { round_id: 4 })).status === "Approved")), "step 7: round 4 is Approved on chain");
    await clickBtn(flowBtn("close")); check(/DONE/.test(await toastText(/DONE|FAIL/)), "step 8: the judge closes the round");
    check(!!(await waitFor(async () => (await view(rounds, "round", { round_id: 4 })).status === "Closed")), "step 8: round 4 is Closed on chain");
    for (let i = 0; i < 40 && !/Series A Preferred/.test(await ev(`document.querySelector("#flow .flow-result").innerText`)); i++) await sleep(500);
    check(/Series A Preferred/.test(await ev(`document.querySelector("#flow .flow-result").innerText`)), "the page shows the judge's new shares by itself");
    const held = await view(rounds, "holdings_of", { holder: judge });
    check(held.some(([c, n]) => c === "Series A Preferred" && BigInt(n) === 4_500_000n), `on chain the judge holds 4,500,000 Series A Preferred (${JSON.stringify(held)})`);
    sampling = false; await sleep(300);
    const spread = Math.max(...heights) - Math.min(...heights);
    check(heights.length > 20 && spread <= 6, `the flow's height stayed stable through every refresh (${heights.length} samples, spread ${spread}px)`);
  } else console.log("     (E2E_SANDBOX not set: sandbox judge-path skipped; it closes a Series A, so run it only on a throwaway sandbox instance)");
} catch (e) { check(false, `e2e aborted: ${e.message}`); }
pumping = false; try { ws.close(); } catch {} chrome.kill();
console.log(`${failed ? "FAIL" : "PASS"} summary: ${total} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
