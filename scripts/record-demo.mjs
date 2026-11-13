// Records a captioned walkthrough of the web app: node scripts/record-demo.mjs [url] [out.mp4]
// Drives headless Chrome over the DevTools protocol, shows a fake cursor + captions, encodes with ffmpeg.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, openSync } from "node:fs";
import { N, VOICE as VOICE_, ttsFile } from "./demo-script.mjs";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 as nsha } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.argv[2] ?? "http://127.0.0.1:5173/";
const OUT = process.argv[3] ?? "demo/rounds-demo.mp4";
const W = 1280, H = 800;
// Pick a debugging port nobody is listening on. If one is taken, Chrome starts without it and this script would silently drive
// whatever browser owns the port (another tool's, or a stale one that still holds old page state), so never assume a fixed port.
let PORT = Number(process.env.RECORD_PORT ?? 9560);
for (; PORT < 9700; PORT++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(800) }); } catch { break; } }
const work = join(process.env.REC_DIR ?? tmpdir(), "rounds-rec"); rmSync(work, { recursive: true, force: true }); mkdirSync(work, { recursive: true });
mkdirSync("demo", { recursive: true });

// The recording plays the whole guided flow on ONE unused sandbox, signed by that sandbox's throwaway founder account (no wallet pop-ups).
const RPC = process.env.RPC_URL ?? "https://test.rpc.fastnear.com";
const rpcQ = async (params) => (await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params }) })).json());
const viewC = async (acct, method, args) => { const j = await rpcQ({ request_type: "call_function", finality: "final", account_id: acct, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") }); const r = j.result?.result; return r ? JSON.parse(Buffer.from(r).toString()) : null; };
const PART = process.env.PART ?? "all";
const ONLY = process.env.ONLY; // ONLY=share records just the shared-payout scene: no sandbox is used up and no key is needed
const ZKMODE = PART === "zk";
const ZKCFG = ZKMODE ? JSON.parse(readFileSync("web/public/zk-sandbox.json", "utf8")) : null;
let SANDBOX = ZKMODE ? ZKCFG.rounds : process.env.SANDBOX;
if (!SANDBOX) for (const c of JSON.parse(readFileSync("web/public/sandboxes.json", "utf8"))) { if (ONLY || (await viewC(c.rounds, "round", { round_id: 4 })) === null) { SANDBOX = c.rounds; break; } }
if (!SANDBOX) throw new Error("no unused sandbox in the pool");
const JUDGE = ZKMODE ? (process.env.ZK_JUDGE ?? "rsbx-bayo-913009.testnet") : SANDBOX.replace("rsbx-rounds-", "rsbx-bayo-");
if (!ONLY && !existsSync(`${process.env.HOME}/.near-credentials/testnet/${JUDGE}.json`)) throw new Error(`no key for ${JUDGE}`);
console.log(`sandbox ${SANDBOX}, signed in as ${JUDGE}`);
async function signAndSend(signer, receiver, act) {
  const args = ["contract", "call-function", "as-transaction", receiver, act.method, "json-args", act.args, "prepaid-gas", `${act.gasTgas} Tgas`, "attached-deposit", `${act.depositYocto} yoctoNEAR`, "sign-as", signer, "network-config", "testnet", "sign-with-legacy-keychain", "display"];
  // asynchronous on purpose: a blocking call here stalls this process while the browser is streaming screencast frames, so the
  // frames for the steps in between are dropped and the video jumps from "before" to "after" while the narration keeps its own clock
  const raw = await new Promise((resolve) => { const p = spawn("near", args, { env: { ...process.env, NO_COLOR: "1" } }); let o = ""; p.stdout.on("data", (d) => (o += d)); p.stderr.on("data", (d) => (o += d)); p.on("close", () => resolve(o)); });
  const out = raw.replace(/\x1b\[[0-9;]*m/g, "");
  const b64 = out.match(/serialized as base64\):\s*\n(\S+)/)?.[1]; if (!b64) throw new Error("signing failed: " + out.slice(-200));
  // the same signed transaction can be sent again safely: if the node answers "pending"/"timeout" while the chain is still finalizing, ask again
  let j; for (let i = 0; i < 8; i++) { j = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "send_tx", params: { signed_tx_base64: b64, wait_until: "FINAL" } }) })).json(); if (!j.error || !/PENDING|TIMEOUT|timed out/i.test(JSON.stringify(j.error))) break; await new Promise((r) => setTimeout(r, 3000)); }
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200)); return j.result;
}
const execActs = async (signer, receiver, acts) => { let last; for (const a of acts) { last = await signAndSend(signer, receiver, a); if (last.status?.Failure) return last; } return last; };
const bindings = [];
// the test signer also signs NEP-413 messages (the wallet-derived keys) with the judge's throwaway key, like a wallet would
const u32 = (n) => Buffer.from([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const bstr = (x) => { const b = Buffer.from(x); return Buffer.concat([u32(b.length), b]); };
function signNep413(m) {
  const cred = JSON.parse(readFileSync(`${process.env.HOME}/.near-credentials/testnet/${JUDGE}.json`, "utf8"));
  const sk = base58.decode(cred.private_key.replace("ed25519:", "")).slice(0, 32);
  const hash = nsha(Buffer.concat([u32(2147484061), bstr(m.message), Buffer.from(m.nonce, "base64"), bstr(m.recipient), Buffer.from([0])]));
  return { accountId: JUDGE, publicKey: cred.public_key, signature: Buffer.from(ed25519.sign(hash, sk)).toString("base64") };
}
// confidential recording: a local relayer submits the claim, and a brand-new account (never registered with the token) receives it
let relayerProc = null, BURNER = "";
if (ZKMODE) {
  const RELAYER = process.env.ZK_RELAYER ?? "rsbx-ada-973123.testnet";
  BURNER = `rsbx-holder-${Date.now().toString().slice(-7)}.testnet`;
  const mk = execFileSync("near", ["account", "create-account", "fund-myself", BURNER, "0.1 NEAR", "autogenerate-new-keypair", "save-to-legacy-keychain", "sign-as", RELAYER, "network-config", "testnet", "sign-with-legacy-keychain", "send"], { env: { ...process.env, NO_COLOR: "1" }, stdio: "pipe" });
  void mk;
  relayerProc = spawn("node", ["scripts/relayer.mjs"], { env: { ...process.env, RELAYER_ACCOUNT: RELAYER, RELAYER_CONTRACT: ZKCFG.rounds, RELAYER_CREDENTIALS: `${process.env.HOME}/.near-credentials/testnet/${RELAYER}.json`, PORT: "8791" }, stdio: ["ignore", process.env.REL_LOG ? openSync(process.env.REL_LOG, "w") : "ignore", process.env.REL_LOG ? openSync(process.env.REL_LOG, "a") : "ignore"] });
  await new Promise((r) => setTimeout(r, 6000));
}

const chrome = spawn("google-chrome", ["--headless=new", `--remote-debugging-port=${PORT}`, `--window-size=${W},${H}`, "--hide-scrollbars", "--force-dark-mode", "--disable-gpu", "--renderer-process-limit=1",
  "--no-first-run", `--user-data-dir=${join(work, "profile")}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets; for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.find((t) => t.type === "page")) break; } catch {} await sleep(200); }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const frames = [];
ws.onmessage = (m) => {
  const j = JSON.parse(m.data);
  if (j.id && pending.has(j.id)) { pending.get(j.id)(j); pending.delete(j.id); }
  else if (j.method === "Runtime.bindingCalled") bindings.push(j.params);
  else if (j.method === "Page.screencastFrame") {
    const n = frames.length, f = join(work, `f${String(n).padStart(6, "0")}.jpg`);
    writeFileSync(f, Buffer.from(j.params.data, "base64")); frames.push({ f, t: performance.now() });
    send("Page.screencastFrameAck", { sessionId: j.params.sessionId });
  }
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result?.result?.value; };

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
await send("Runtime.addBinding", { name: "nodeSend" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__testWallet = { account: ${JSON.stringify(JUDGE)}, send: (receiver, acts) => new Promise((res) => { const id = Math.random().toString(36).slice(2); (window.__p ||= {})[id] = res; window.nodeSend(JSON.stringify({ id, receiver, acts })); }), signMessage: (message, recipient, nonce) => new Promise((res) => { const id = Math.random().toString(36).slice(2); (window.__p ||= {})[id] = res; window.nodeSend(JSON.stringify({ kind: "sign", id, message, recipient, nonce: btoa(String.fromCharCode(...nonce)) })); }) };` });
(async () => { for (;;) { while (bindings.length) { const b = bindings.shift(); const msg0 = JSON.parse(b.payload); if (msg0.kind === "sign") { await ev(`window.__p[${JSON.stringify(msg0.id)}](${JSON.stringify(signNep413(msg0))})`); continue; } const { id: cid, receiver, acts } = msg0; let out; try { console.log(`signer: ${acts.map((x) => x.method).join("+")} -> ${receiver.slice(0, 26)}`); out = await execActs(JUDGE, receiver, acts); if (out?.status?.Failure) console.log("signer failure:", JSON.stringify(out.status.Failure).slice(0, 300)); } catch (e) { console.log("signer error:", String(e.message).slice(0, 300)); out = { status: { Failure: String(e.message) }, transaction: { hash: null } }; } await ev(`window.__p[${JSON.stringify(cid)}](${JSON.stringify(out)})`); } await sleep(150); } })();
await send("Page.navigate", { url: ZKMODE ? `${URL_}?relayer=${encodeURIComponent("http://127.0.0.1:8791/relay-claim")}` : `${URL_}?sandbox=${SANDBOX}` }); await sleep(2500);

// overlay: cursor, ripple, caption
await ev(`(() => {
  const s = document.createElement("style"); s.textContent = \`
  #rc{position:fixed;left:0;top:0;width:26px;height:26px;z-index:99999;pointer-events:none;transition:transform .9s cubic-bezier(.45,.05,.2,1);transform:translate(640px,400px);filter:drop-shadow(0 2px 4px #000)}
  #rr{position:fixed;z-index:99998;pointer-events:none;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid #fff;opacity:0}
  #rr.go{animation:rip .5s ease-out}@keyframes rip{from{opacity:.9;transform:scale(.4)}to{opacity:0;transform:scale(3.2)}}
  #rcap{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);max-width:1000px;z-index:99997;pointer-events:none;background:rgba(0,0,0,.82);border:1px solid #333;color:#f2f2f2;font:500 22px/1.4 system-ui,sans-serif;padding:14px 22px;border-radius:12px;text-align:center;transition:opacity .25s;opacity:0}
  #rcap.on{opacity:1}
  #title{position:fixed;inset:0;z-index:99996;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:system-ui,sans-serif;transition:opacity .6s}
  #title h1{font-size:64px;margin:0 0 14px;letter-spacing:-1.5px}#title p{font-size:24px;color:#a1a1a1;margin:4px 0}\`;
  document.head.appendChild(s);
  const c = document.createElement("div"); c.id = "rc"; c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#000" stroke-width="1.5"/></svg>'; document.body.appendChild(c);
  const r = document.createElement("div"); r.id = "rr"; document.body.appendChild(r);
  const k = document.createElement("div"); k.id = "rcap"; document.body.appendChild(k);
  const t = document.createElement("div"); t.id = "title"; t.style.display = "none"; t.innerHTML = '<h1>Rounds</h1><p>Ownership and payouts a DAO approves, and anyone can check</p><p style="font-size:18px">A NEAR testnet prototype · built at NEAR HACKATHON</p>'; document.body.appendChild(t);
})()`);

if (PART === "share") { // start capturing already at the Share a pot section, so the clip can replace that part of another recording
  await ev(`document.getElementById("title")?.remove()`); await sleep(800);
  await ev(`document.getElementById("share").scrollIntoView({behavior:"instant",block:"start"})`); await sleep(1500);
}
await send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: W, maxHeight: H, everyNthFrame: 1 });

const voice = []; let t0 = null;
const relT = () => (performance.now() - (frames[0]?.t ?? performance.now())) / 1000;
const waits = []; // spans where the script only waits for the chain or a proof: cut from the video (never while the narrator speaks)
const markWait = async (fn) => { const a = relT(); try { return await fn(); } finally { waits.push([a, relT()]); } };
const EDGE = process.env.EDGE_TTS ?? "edge-tts", VOICE = VOICE_;
const narrate = async (text, actions = async () => {}) => { // one continuous clip per scene; the cursor acts WHILE it plays
  const mp3 = ttsFile(text);
  if (!existsSync(mp3)) { mkdirSync(join(mp3, ".."), { recursive: true }); execFileSync(EDGE, ["--voice", VOICE, "--rate=-2%", "--text", text, "--write-media", mp3], { stdio: "ignore" }); }
  const dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3]).toString()) * 1000;
  voice.push({ wav: mp3, at: (performance.now() - (frames[0]?.t ?? performance.now())) / 1000, dur: dur / 1000 });
  const t0 = performance.now();
  await actions();
  await sleep(Math.max(300, dur - (performance.now() - t0)) + 350);
};
const quiet = async () => {};
const rect = async (sel, fx = 0.5, fy = 0.5) => { for (let i = 0; i < 20 && !(await ev(`!!document.querySelector(${JSON.stringify(sel)})`)); i++) await sleep(250); return rect0(sel, fx, fy); };
const rect0 = (sel, fx = 0.5, fy = 0.5) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw new Error("no "+${JSON.stringify(sel)});const b=e.getBoundingClientRect();return [b.left+b.width*${fx},b.top+b.height*${fy}]})()`);
const scrollTo = async (sel, block = "start") => { await quiet(); await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({behavior:"smooth",block:${JSON.stringify(block)}})`); await sleep(1200); };
let cur = [640, 400];
const moveXY = async (x, y, ms = 900) => { cur = [x, y]; await ev(`document.getElementById("rc").style.transform="translate(${x}px,${y}px)"`); await sleep(ms + 100); };
// (y < 140 below: the sticky nav and role bar cover the top of the page)
const point = async (sel, fx, fy, ms) => { let [x, y] = await rect(sel, fx, fy); if (y < 140 || y > H - 50) { await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({behavior:"instant",block:"center"})`); await sleep(500); [x, y] = await rect0(sel, fx, fy); } await moveXY(x, y, ms); };
const click = async (sel, fx, fy) => {
  await point(sel, fx, fy); const [x, y] = cur;
  await ev(`(()=>{const r=document.getElementById("rr");r.style.left="${x}px";r.style.top="${y}px";r.classList.remove("go");void r.offsetWidth;r.classList.add("go")})()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); await sleep(500);
};
// like click(), but the press itself is a DOM click: a real mouse press is lost when the card redraws between press and release
const clickJs = async (sel) => { await point(sel); const [x, y] = cur;
  await ev(`(()=>{const r=document.getElementById("rr");r.style.left="${x}px";r.style.top="${y}px";r.classList.remove("go");void r.offsetWidth;r.classList.add("go")})()`);
  await ev(`document.querySelector(${JSON.stringify(sel)}).click()`); await sleep(500); };
// press until the page reacts (`probe` becomes true): on a slow machine a press can land while the card is redrawing and be lost
const clickJsUntil = async (sel, probe) => {
  for (let i = 0; i < 5; i++) { await clickJs(sel); for (let j = 0; j < 16; j++) { if (await ev(probe)) return; await sleep(500); } }
  console.log("DIAG no reaction to", sel, await ev(`JSON.stringify({disabled:document.querySelector(${JSON.stringify(sel)})?.disabled, bout:(document.getElementById("zk-bout")?.textContent??"").slice(0,120), claim:(document.getElementById("zk-claim-body")?.textContent??"").slice(-160)})`));
};
const typeInto = async (sel, value) => { await click(sel); await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.focus();e.select()})()`); await send("Input.insertText", { text: String(value) }); await sleep(900); };
const drag = async (sel, from, to, steps = 24) => { // slider drag between fractions of its width
  const [x0, y] = await rect(sel, from, 0.5); const [x1] = await rect(sel, to, 0.5);
  await moveXY(x0, y, 700);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y, button: "left", clickCount: 1 });
  for (let i = 1; i <= steps; i++) { const x = x0 + ((x1 - x0) * i) / steps; await ev(`document.getElementById("rc").style.transition="none";document.getElementById("rc").style.transform="translate(${x}px,${y}px)"`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 }); await sleep(60); }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y, button: "left", clickCount: 1 });
  await ev(`document.getElementById("rc").style.transition=""`); cur = [x1, y]; await sleep(600);
};

process.on("uncaughtException", async (e) => { try { console.log("DIAG", await ev(`JSON.stringify({u:location.href,n:document.querySelectorAll("[id]").length,t:!!document.getElementById("cap-table"),y:scrollY,c:document.getElementById("contract")?.value,rv:document.getElementById("review-body")?.innerText.slice(0,100),co:document.getElementById("chain-out")?.innerText.slice(0,80)})`)); } catch {} console.log(String(e.message).slice(0,200)); chrome.kill(); process.exit(1); });
// ---- script ----
await sleep(PART === "tail" || PART === "share" ? 600 : 2200);
await ev(`const t=document.getElementById("title"); if(t){t.style.opacity=0}`); await sleep(900); await ev(`document.getElementById("title")?.remove()`);
if (PART !== "share") { await ev(`window.scrollTo(0,0)`); await sleep(500); }

const flowBtn = (a) => `#flow [data-flow="${a}"]`;
const rowCls = (n) => ev(`document.querySelectorAll("#flow .flow-row")[${n - 1}]?.className ?? ""`);
const waitRow = async (n, re, ms = 150000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (re.test(await rowCls(n))) return; await sleep(500); } throw new Error(`step ${n} never reached ${re}`); };
// press a guided step's button (waits until it is enabled), then wait until the page itself marks the step done; skipped if already done, so a retry is safe
const doStep = async (act, n) => {
  if (/done/.test(await rowCls(n))) return;
  await ev(`document.querySelector(${JSON.stringify(flowBtn(act))}).scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(1300);
  for (let i = 0; i < 240 && !(await ev(`(()=>{const b=document.querySelector(${JSON.stringify(flowBtn(act))});return !!b&&!b.disabled})()`)); i++) await sleep(500);
  await click(flowBtn(act)); await markWait(() => waitRow(n, /done/));
};

// the same for the "Share a pot" run card
const sBtn = (a) => `#share-run-body [data-share="${a}"]`;
const sRow = (n) => ev(`document.querySelectorAll("#share-run-body .flow-row")[${n - 1}]?.className ?? ""`);
const doShare = async (act, n) => {
  const t0 = performance.now(); let first = true;
  if (/done/.test(await sRow(n))) return;
  await ev(`document.querySelector(${JSON.stringify(sBtn(act))}).scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(1300);
  for (let i = 0; i < 240 && !(await ev(`(()=>{const b=document.querySelector(${JSON.stringify(sBtn(act))});return !!b&&!b.disabled})()`)); i++) await sleep(500);
  const rel = () => ((performance.now() - (frames[0]?.t ?? performance.now())) / 1000).toFixed(1);
  console.log(`[${rel()}s] pressing ${act} (frames so far ${frames.length})`);
  await click(sBtn(act));
  const w0 = relT(); while (performance.now() - t0 < 180000) { if (/done/.test(await sRow(n))) { waits.push([w0, relT()]); console.log(`[${rel()}s] step ${n} (${act}) done (frames so far ${frames.length})`); return; } await sleep(500); }
  void first; throw new Error(`share step ${n} never finished`);
};
const waitFor = async (js, ms = 90000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (await ev(js)) return true; await sleep(500); } throw new Error(`timed out waiting for ${js}`); };

// PART=head records the guided flow and the shared payout (it uses up a sandbox); PART=tail records the voting and token scenes and the close
// (read-only: it needs no unused sandbox, set ONLY=1 SANDBOX=<any sandbox>). The two are joined afterwards with ffmpeg.
// PART=zk records the confidential mode on the confidential sandbox, with a local relayer and a brand-new recipient account
if (PART === "zk") {
  const zRow = (n) => ev(`document.querySelectorAll("#zk-run .flow-row")[${n - 1}]?.className ?? ""`);
  const setFileJs = (id, expr, name) => ev(`(()=>{const v=${expr};const inp=document.getElementById(${JSON.stringify(id)});const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(v)],${JSON.stringify(name)},{type:"application/json"}));inp.files=dt.files;inp.dispatchEvent(new Event("change"))})()`);
  const doZk = async (act, n) => {
    if (/done/.test(await zRow(n))) return;
    const sel = `#zk-run [data-zk="${act}"]`;
    if (["pexit", "pfund", "papprove"].includes(act)) { if (await ev(`document.getElementById("zk-p-payout").hidden`)) { await click('.ztab[data-ztab="payout"]'); await sleep(600); } }
    await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(1300);
    for (let i = 0; i < 240 && !(await ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});return !!b&&!b.disabled})()`)); i++) await sleep(500);
    await click(sel);
    const t0 = performance.now(), w0 = relT(); let lastTry = performance.now();
    while (performance.now() - t0 < 240000) {
      if (/done/.test(await zRow(n))) { waits.push([w0, relT()]); return; }
      // a click can be lost when the card redraws at that moment: press again only if nothing is in flight (the card says "working" while a step runs)
      if (performance.now() - lastTry > 15000 && await ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});return !!b&&!b.disabled&&!/working/.test(document.getElementById("zk-run").innerText)})()`)) { await ev(`document.querySelector(${JSON.stringify(sel)}).click()`); lastTry = performance.now(); }
      await sleep(500);
    }
    throw new Error(`confidential step ${n} (${act}) never finished`);
  };
  const next0 = await viewC(ZKCFG.rounds, "next_round_id", {}); // the round this recording will create
  await scrollTo("#zk");
  await narrate(N.zkIntro, async () => { await point("#zk h2", 0.3, 0.5); await sleep(5000); await click("#zk details.zd summary"); await sleep(9000); await click("#zk details.zd summary"); await point("#zk-run", 0.5, 0.15); });
  await narrate(N.zkSetup, async () => { await doZk("faucet", 2); await doZk("officer", 3); });
  // the board member (the judge plays one here) publishes an encryption key derived from their wallet, so the table can be sealed for them
  await narrate(N.zkKeys, async () => {
    await typeInto("#zk-members", JUDGE); await sleep(600);
    await click("#zk-regkey");
    await markWait(() => waitFor(`/publish my encryption key/.test(document.getElementById("toast")?.innerText ?? "") && /DONE|FAIL/.test(document.getElementById("toast")?.innerText ?? "")`, 120000));
    await markWait(() => waitFor(`/ready/.test(document.getElementById("zk-memstat")?.textContent ?? "")`, 60000)); await point("#zk-memstat", 0.2, 0.5); await sleep(1200);
  });
  await narrate(N.zkPropose, async () => { await doZk("propose", 4); });
  // silent preparation (cut from the video): open the card, wait for the new round to be readable, pick it
  await click("details:has(#zk-board-body) > summary"); await sleep(900);
  await ev(`document.getElementById("zk-btable-drop").scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(1300);
  await markWait(async () => { for (let i = 0; i < 40 && !(await ev(`!![...document.querySelectorAll("#zk-bround option")].find((o) => o.value === "${next0}")`)); i++) { await ev(`document.getElementById("zk-breload").click()`); await sleep(3000); } });
  await ev(`document.getElementById("zk-bround").value="${next0}";document.getElementById("zk-bround").dispatchEvent(new Event("change"))`); await sleep(600);
  await narrate(N.zkBoard, async () => {
    await clickJsUntil("#zk-bwallet", `(document.getElementById("zk-bout")?.textContent ?? "").length > 0`);
    await markWait(() => waitFor(`/Table matches the on-chain root/.test(document.getElementById("zk-bout")?.textContent ?? "")`, 120000)); await sleep(800);
    await ev(`document.getElementById("zk-bout").scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(1500); await point("#zk-bout", 0.3, 0.2); await sleep(1500);
  });
  await narrate(N.zkBoard2, async () => {
    await ev(`document.getElementById("zk-btable-drop").scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(900);
    await point("#zk-btable-drop", 0.5, 0.5);
    await setFileJs("zk-btable", "(()=>{const t=JSON.parse(JSON.stringify(window.__zkBuilt.tableFile));t.entries[0].shares=String(BigInt(t.entries[0].shares)+1n);return t})()", "rounds-table-file.json"); await sleep(600);
    await click("#zk-bcheck"); await waitFor(`/DIFFERENT root/.test(document.getElementById("zk-bout")?.textContent ?? "")`, 120000); await sleep(600);
    await ev(`document.getElementById("zk-bout").scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(1200); await point("#zk-bout", 0.3, 0.2); await sleep(1800);
  });
  await narrate(N.zkFund, async () => { await doZk("fund", 5); await doZk("approve", 6); await doZk("close", 7); });
  await narrate(N.zkPayout, async () => { await doZk("pexit", 8); await doZk("pfund", 9); await ev(`(()=>{const e=document.getElementById("zk-fee");e.value="5";e.dispatchEvent(new Event("change"))})()`); await sleep(1200); await doZk("papprove", 10); });
  await narrate(N.zkClaim, async () => {
    // a holder with no files at all: the browser's stored state is wiped, then the wallet alone brings the claim and the key back
    await ev(`sessionStorage.clear()`);
    await ev(`document.getElementById("zk-claim-body").scrollIntoView({behavior:"smooth",block:"start"})`); await sleep(1500);
    await clickJsUntil("#zk-recover", `/Asking your wallet|Recovered|FAIL/.test(document.getElementById("zk-claim-body")?.textContent ?? "")`);
    await markWait(() => waitFor(`/Recovered \\d+ claim file/.test(document.getElementById("zk-claim-body")?.innerText ?? "") && !/Reading the chain/.test(document.getElementById("zk-claim-body")?.innerText ?? "")`, 120000));
    await point("#zk-claim-body", 0.5, 0.45); await sleep(1200);
    await typeInto("#zk-recipient", BURNER); await sleep(1200);
    await click("#zk-claim-btn");
    await markWait(() => waitFor(`/claimed to|FAIL/.test(document.getElementById("toast")?.innerText ?? "")`, 300000));
  });
  const tt = await ev(`document.getElementById("toast")?.innerText ?? ""`); console.log("claim toast:", tt.replace(/\s+/g, " ").slice(0, 160));
  if (!/DONE/.test(tt)) throw new Error("the private claim did not complete");
  await narrate(N.zkDone, async () => { await point("#toast", 0.5, 0.5); await sleep(1500); });
  for (let i = 0; i < 20; i++) { try { const bal = await viewC(ZKCFG.token, "ft_balance_of", { account_id: BURNER }); if (bal && bal !== "0") { console.log("recipient balance", BURNER, bal); break; } } catch { /* an RPC hiccup after the claim must never lose the recording */ } await sleep(1500); }
  await sleep(600);
}

if (PART === "all" || PART === "head") {
await narrate(N.publicIntro, async () => {
  await sleep(1500); await point("h1", 0.4, 0.5); await sleep(3500);
  await ev(`document.getElementById("hero-bars").scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(1500);
  await point("#hero-bars", 0.3, 0.3); await sleep(3500); await point("#hero-bars", 0.7, 0.8); await sleep(1000);
  await scrollTo("#cap"); await point("#cap-table", 0.5, 0.3);
});

await scrollTo("#model");
await narrate(N.modeler, async () => {
  await point("#form", 0.5, 0.08); await sleep(3500); await point("#ada", 0.5, 0.5); await sleep(4000); await point("#model-out", 0.5, 0.25);
});

await scrollTo("#try");
await narrate(N.flow, async () => { await point("#flow", 0.5, 0.08); await sleep(2500); await doStep("faucet", 2); await doStep("officer", 3); await doStep("propose", 5); });
await narrate(N.approve, async () => { await doStep("deposit", 6); await doStep("approve", 7); await doStep("close", 8); });
await narrate(N.result, async () => {
  await ev(`document.querySelector("#flow .flow-result").scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(1300);
  for (let i = 0; i < 120 && !/Series A Preferred/.test(await ev(`document.querySelector("#flow .flow-result").innerText`)); i++) await sleep(500);
  await point("#flow .flow-result", 0.3, 0.5);
});

}
if (PART !== "tail" && PART !== "zk") { // PART=share records only this block, on any sandbox, so the payout scenes can be redone without using one up
// shared payout: first the calculator, then a real run on this sandbox (it now has a Series A investor among its holders)
await scrollTo("#share");
await narrate(N.share, async () => { await sleep(1500); await drag("#pot", 0.1, 0.45, 14); await sleep(1200); await drag("#pot", 0.45, 0.1, 14); });
await narrate(N.shareRun, async () => {
  await ev(`document.getElementById("share-run").scrollIntoView({behavior:"smooth",block:"start"})`); await sleep(1500);
  await waitFor(`document.querySelectorAll("#share-run-body .flow-result tr").length >= 3`);
  await point("#share-run-body .flow-result table", 0.5, 0.4); await sleep(2500);
  await doShare("officer", 3); await doShare("propose", 4); await doShare("fund", 5); await doShare("approve", 6); await doShare("pay", 7);
});
// the narration only claims "paid" once the table really says so
await waitFor(`/every holder was paid once/.test(document.querySelector("#share-run-body .flow-result").innerText)`, 120000);
await narrate(N.sharePaid, async () => { await ev(`document.querySelector("#share-run-body .flow-result").scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(1200); await point("#share-run-body .flow-result table", 0.5, 0.4); });
if (!/Paid/.test(await ev(`document.querySelector("#share-run-body .flow-result").innerText`))) throw new Error("the payout table does not say Paid");

}
if (PART === "all" || PART === "head") {
// verify: the sandbox, re-hashed in the browser
await scrollTo("#verify");
await narrate(N.verify, async () => {
  await point("#pre-sandbox", 0.5, 0.5); await click("#pre-sandbox");
  for (let i = 0; i < 90 && !(await ev(`!!document.querySelector("#chain-out .chain-tbl")`)); i++) await sleep(500);
  await ev(`document.querySelectorAll("#chain-out .chain-tbl")[1].scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(1400);
  await point("#chain-out .chain-tbl:nth-of-type(2) tr:nth-child(5)", 0.6, 0.5); await sleep(2500);
  await point("#chain-out .chain-tbl:nth-of-type(2) tr:nth-child(5)", 0.95, 0.5);
});
const chainTxt = await ev(`document.getElementById("chain-out").innerText`);
console.log(chainTxt.split("\n").filter((l) => /PASS|FAIL|Round/.test(l)).join("\n"));
if (/FAIL/.test(chainTxt) || !/PASS/.test(chainTxt)) throw new Error("the on-chain check did not pass; not encoding");

}
// voting: the board's proposals on the finished demo, then the token contract
if (PART === "all" || PART === "tail") {
// calm pacing: scroll first (no narration over the movement), then the picture holds still while the line is read
await click("#pre-demo"); await waitFor(`!!document.querySelector("#proposal-4")`);
await ev(`document.getElementById("proposal-4").scrollIntoView({behavior:"smooth",block:"start"})`); await sleep(1800);
await narrate(N.review, async () => { await point("#proposal-4 .rv-h", 0.5, 0.5); await sleep(4500); await point("#proposal-4 table", 0.5, 0.3); await sleep(4500); await point("#proposal-4 table", 0.5, 0.8); });
await ev(`document.getElementById("proposal-9").scrollIntoView({behavior:"smooth",block:"start"})`); await sleep(1800);
await narrate(N.review2, async () => { await point("#proposal-9 .rv-h", 0.5, 0.5); await sleep(3500); await point("#proposal-9 table", 0.5, 0.4); });
const reviewTxt = await ev(`document.getElementById("review-body").innerText`);
if (/DOES NOT MATCH/.test(reviewTxt) || !/VERIFIED/.test(reviewTxt)) throw new Error("the review card did not verify the demo's proposals");
await ev(`window.scrollTo({top:0,behavior:"smooth"})`); await sleep(2000);
await narrate(N.close2, async () => { await point("h1", 0.4, 0.5); await sleep(5000); await point("h1", 0.6, 0.8); });
await sleep(800);
}

// ---- encode ----
await send("Page.stopScreencast"); await sleep(300); ws.close(); chrome.kill(); relayerProc?.kill();
const end = performance.now(); const list = [];
const vint = voice.map((v) => [v.at - 0.2, v.at + v.dur + 0.4]);
let cuts = []; for (const [wa, wb] of waits) { let segs = [[wa + 1.4, wb - 0.7]]; for (const [x, y] of vint) segs = segs.flatMap(([s0, e0]) => (y <= s0 || x >= e0 ? [[s0, e0]] : [[s0, Math.min(e0, x)], [Math.max(s0, y), e0]])); cuts.push(...segs.filter(([s0, e0]) => e0 - s0 > 2.0)); }
cuts.sort((p, q) => p[0] - q[0]);
const overlap = (a0, b0) => cuts.reduce((acc, [s0, e0]) => acc + Math.max(0, Math.min(b0, e0) - Math.max(a0, s0)), 0);
const cutBefore = (t) => overlap(0, t);
console.log(`cutting ${cuts.length} waits (${cuts.reduce((a0, [s0, e0]) => a0 + e0 - s0, 0).toFixed(0)} s):`, cuts.map(([s0, e0]) => `${s0.toFixed(0)}-${e0.toFixed(0)}`).join(" "));
frames.forEach((fr, i) => { const tt = (fr.t - frames[0].t) / 1000, nt = ((frames[i + 1]?.t ?? end) - frames[0].t) / 1000; if (cuts.some(([s0, e0]) => tt > s0 && tt < e0)) return; const d = nt - tt - overlap(tt, nt); list.push(`file '${fr.f}'\nduration ${Math.max(d, 0.01).toFixed(3)}`); });
list.push(`file '${frames.at(-1).f}'`);
for (const v of voice) v.at -= cutBefore(v.at);
writeFileSync(join(work, "list.txt"), list.join("\n"));
const silent = join(work, "silent.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-threads", "2", "-f", "concat", "-safe", "0", "-i", join(work, "list.txt"), "-vf", `fps=25,scale=${W}:${H},format=yuv420p`, "-c:v", "libx264", "-crf", "23", silent]);
const ins = voice.flatMap((v) => ["-i", v.wav]);
const filt = voice.map((v, i) => `[${i + 1}:a]adelay=${Math.round(v.at * 1000)}:all=1[a${i}]`).join(";") + ";" + voice.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${voice.length}:normalize=0[aud]`;
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-threads", "2", "-i", silent, ...ins, "-filter_complex", filt, "-map", "0:v", "-map", "[aud]", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", OUT]);
console.log(`wrote ${OUT} from ${frames.length} frames`);
process.exit(0);
