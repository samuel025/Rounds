// Records a captioned walkthrough of the web app: node scripts/record-demo.mjs [url] [out.mp4]
// Drives headless Chrome over the DevTools protocol, shows a fake cursor + captions, encodes with ffmpeg.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { N, VOICE as VOICE_, ttsFile } from "./demo-script.mjs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.argv[2] ?? "http://127.0.0.1:5173/";
const OUT = process.argv[3] ?? "demo/rounds-demo.mp4";
const W = 1280, H = 800, PORT = 9333;
const work = join(process.env.REC_DIR ?? tmpdir(), "rounds-rec"); rmSync(work, { recursive: true, force: true }); mkdirSync(work, { recursive: true });
mkdirSync("demo", { recursive: true });

// The recording plays the whole guided flow on ONE unused sandbox, signed by that sandbox's throwaway founder account (no wallet pop-ups).
const RPC = process.env.RPC_URL ?? "https://test.rpc.fastnear.com";
const rpcQ = async (params) => (await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params }) })).json());
const viewC = async (acct, method, args) => { const j = await rpcQ({ request_type: "call_function", finality: "final", account_id: acct, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") }); const r = j.result?.result; return r ? JSON.parse(Buffer.from(r).toString()) : null; };
const PART = process.env.PART ?? "all";
const ONLY = process.env.ONLY; // ONLY=share records just the shared-payout scene: no sandbox is used up and no key is needed
let SANDBOX = process.env.SANDBOX;
if (!SANDBOX) for (const c of JSON.parse(readFileSync("web/public/sandboxes.json", "utf8"))) { if (ONLY || (await viewC(c.rounds, "round", { round_id: 4 })) === null) { SANDBOX = c.rounds; break; } }
if (!SANDBOX) throw new Error("no unused sandbox in the pool");
const JUDGE = SANDBOX.replace("rsbx-rounds-", "rsbx-bayo-");
if (!ONLY && !existsSync(`${process.env.HOME}/.near-credentials/testnet/${JUDGE}.json`)) throw new Error(`no key for ${JUDGE}`);
console.log(`sandbox ${SANDBOX}, signed in as ${JUDGE}`);
async function signAndSend(signer, receiver, act) {
  const args = ["contract", "call-function", "as-transaction", receiver, act.method, "json-args", act.args, "prepaid-gas", `${act.gasTgas} Tgas`, "attached-deposit", `${act.depositYocto} yoctoNEAR`, "sign-as", signer, "network-config", "testnet", "sign-with-legacy-keychain", "display"];
  const r = spawnSync("near", args, { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  const out = ((r.stderr ?? "") + (r.stdout ?? "")).replace(/\x1b\[[0-9;]*m/g, "");
  const b64 = out.match(/serialized as base64\):\s*\n(\S+)/)?.[1]; if (!b64) throw new Error("signing failed: " + out.slice(-200));
  const j = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "send_tx", params: { signed_tx_base64: b64, wait_until: "FINAL" } }) })).json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200)); return j.result;
}
const execActs = async (signer, receiver, acts) => { let last; for (const a of acts) { last = await signAndSend(signer, receiver, a); if (last.status?.Failure) return last; } return last; };
const bindings = [];

const chrome = spawn("google-chrome", ["--headless=new", `--remote-debugging-port=${PORT}`, `--window-size=${W},${H}`, "--hide-scrollbars", "--force-dark-mode",
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
await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__testWallet = { account: ${JSON.stringify(JUDGE)}, send: (receiver, acts) => new Promise((res) => { const id = Math.random().toString(36).slice(2); (window.__p ||= {})[id] = res; window.nodeSend(JSON.stringify({ id, receiver, acts })); }) };` });
(async () => { for (;;) { while (bindings.length) { const b = bindings.shift(); const { id: cid, receiver, acts } = JSON.parse(b.payload); let out; try { out = await execActs(JUDGE, receiver, acts); } catch (e) { out = { status: { Failure: String(e.message) }, transaction: { hash: null } }; } await ev(`window.__p[${JSON.stringify(cid)}](${JSON.stringify(out)})`); } await sleep(150); } })();
await send("Page.navigate", { url: `${URL_}?sandbox=${SANDBOX}` }); await sleep(2500);

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
  const t = document.createElement("div"); t.id = "title"; t.innerHTML = '<h1>Rounds</h1><p>Ownership and payouts a DAO approves, and anyone can check</p><p style="font-size:18px">A NEAR testnet prototype · built at NEAR HACKATHON</p>'; document.body.appendChild(t);
})()`);

await send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: W, maxHeight: H, everyNthFrame: 1 });

const voice = []; let t0 = null;
const EDGE = process.env.EDGE_TTS ?? "edge-tts", VOICE = VOICE_;
const narrate = async (text, actions = async () => {}) => { // one continuous clip per scene; the cursor acts WHILE it plays
  const mp3 = ttsFile(text);
  if (!existsSync(mp3)) { mkdirSync(join(mp3, ".."), { recursive: true }); execFileSync(EDGE, ["--voice", VOICE, "--rate=-2%", "--text", text, "--write-media", mp3], { stdio: "ignore" }); }
  const dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3]).toString()) * 1000;
  voice.push({ wav: mp3, at: (performance.now() - (frames[0]?.t ?? performance.now())) / 1000 });
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
const point = async (sel, fx, fy, ms) => { let [x, y] = await rect(sel, fx, fy); if (y < 70 || y > H - 50) { await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({behavior:"instant",block:"center"})`); await sleep(500); [x, y] = await rect0(sel, fx, fy); } await moveXY(x, y, ms); };
const click = async (sel, fx, fy) => {
  await point(sel, fx, fy); const [x, y] = cur;
  await ev(`(()=>{const r=document.getElementById("rr");r.style.left="${x}px";r.style.top="${y}px";r.classList.remove("go");void r.offsetWidth;r.classList.add("go")})()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); await sleep(500);
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
await sleep(PART === "tail" ? 600 : 2200);
await ev(`document.getElementById("title").style.opacity=0`); await sleep(900); await ev(`document.getElementById("title").remove()`);
await ev(`window.scrollTo(0,0)`); await sleep(500);

const flowBtn = (a) => `#flow [data-flow="${a}"]`;
const rowCls = (n) => ev(`document.querySelectorAll("#flow .flow-row")[${n - 1}]?.className ?? ""`);
const waitRow = async (n, re, ms = 150000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (re.test(await rowCls(n))) return; await sleep(500); } throw new Error(`step ${n} never reached ${re}`); };
// press a guided step's button (waits until it is enabled), then wait until the page itself marks the step done; skipped if already done, so a retry is safe
const doStep = async (act, n) => {
  if (/done/.test(await rowCls(n))) return;
  await ev(`document.querySelector(${JSON.stringify(flowBtn(act))}).scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(1300);
  for (let i = 0; i < 240 && !(await ev(`(()=>{const b=document.querySelector(${JSON.stringify(flowBtn(act))});return !!b&&!b.disabled})()`)); i++) await sleep(500);
  await click(flowBtn(act)); await waitRow(n, /done/);
};

// the same for the "Share a pot" run card
const sBtn = (a) => `#share-run-body [data-share="${a}"]`;
const sRow = (n) => ev(`document.querySelectorAll("#share-run-body .flow-row")[${n - 1}]?.className ?? ""`);
const doShare = async (act, n) => {
  const t0 = performance.now(); let first = true;
  if (/done/.test(await sRow(n))) return;
  await ev(`document.querySelector(${JSON.stringify(sBtn(act))}).scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(1300);
  for (let i = 0; i < 240 && !(await ev(`(()=>{const b=document.querySelector(${JSON.stringify(sBtn(act))});return !!b&&!b.disabled})()`)); i++) await sleep(500);
  await click(sBtn(act));
  while (performance.now() - t0 < 180000) { if (/done/.test(await sRow(n))) return; await sleep(500); }
  void first; throw new Error(`share step ${n} never finished`);
};
const waitFor = async (js, ms = 90000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (await ev(js)) return true; await sleep(500); } throw new Error(`timed out waiting for ${js}`); };

// PART=head records the guided flow and the shared payout (it uses up a sandbox); PART=tail records the voting and token scenes and the close
// (read-only: it needs no unused sandbox, set ONLY=1 SANDBOX=<any sandbox>). The two are joined afterwards with ffmpeg.
if (PART !== "tail") {
await narrate(N.hook, async () => {
  await sleep(1500); await point("h1", 0.4, 0.5); await sleep(7500);
  await ev(`document.getElementById("hero-bars").scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(1500);
  await point("#hero-bars", 0.3, 0.3); await sleep(4500); await point("#hero-bars", 0.7, 0.8);
});

await narrate(N.basics, async () => {
  await ev(`document.getElementById("intro").scrollIntoView({behavior:"smooth",block:"start"})`); await sleep(1300);
  await point(".gloss summary", 0.3, 0.5); await click(".gloss summary"); await sleep(3500); await click(".gloss summary"); await sleep(500);
  await scrollTo("#cap"); await point("#cap-table", 0.5, 0.3);
});

await scrollTo("#model");
await narrate(N.modeler, async () => {
  await point("#form", 0.5, 0.08); await sleep(3500); await point("#ada", 0.5, 0.5); await sleep(4000); await point("#model-out", 0.5, 0.25);
});

await scrollTo("#try");
await narrate(N.flow, async () => { await point("#flow", 0.5, 0.08); await sleep(5000); await point("#flow .flow-row:nth-child(1) .flow-n", 0.5, 0.5); });
await narrate(N.usdc, async () => { await doStep("faucet", 2); });
await narrate(N.officer, async () => { await doStep("officer", 3); });
await narrate(N.propose, async () => { await doStep("propose", 5); });
await narrate(N.fund, async () => { await doStep("deposit", 6); });
await narrate(N.approve, async () => { await doStep("approve", 7); });
await narrate(N.close, async () => { await doStep("close", 8); });
await narrate(N.result, async () => {
  await ev(`document.querySelector("#flow .flow-result").scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(1300);
  for (let i = 0; i < 120 && !/Series A Preferred/.test(await ev(`document.querySelector("#flow .flow-result").innerText`)); i++) await sleep(500);
  await point("#flow .flow-result", 0.3, 0.5);
});

// shared payout: first the calculator, then a real run on this sandbox (it now has a Series A investor among its holders)
await scrollTo("#share");
await narrate(N.share, async () => { await sleep(4500); await drag("#pot", 0.1, 0.45, 20); await sleep(3000); await drag("#pot", 0.45, 0.1, 20); });
await narrate(N.shareRun, async () => {
  await ev(`document.getElementById("share-run").scrollIntoView({behavior:"smooth",block:"start"})`); await sleep(1500);
  await waitFor(`document.querySelectorAll("#share-run-body .flow-result tr").length >= 3`);
  await point("#share-run-body .flow-result table", 0.5, 0.4); await sleep(2500);
  await doShare("officer", 3); await doShare("propose", 4);
});
await narrate(N.shareFund, async () => { await doShare("fund", 5); });
await narrate(N.shareApprove, async () => { await doShare("approve", 6); });
await narrate(N.sharePay, async () => {
  await doShare("pay", 7);
  await waitFor(`/every holder was paid once/.test(document.querySelector("#share-run-body .flow-result").innerText)`, 120000);
  await point("#share-run-body .flow-result table", 0.5, 0.4);
});

// verify: the sandbox, re-hashed in the browser
await scrollTo("#verify");
await narrate(N.verify, async () => {
  await point("#pre-sandbox", 0.5, 0.5); await click("#pre-sandbox");
  for (let i = 0; i < 90 && !(await ev(`!!document.querySelector("#chain-out .chain-tbl")`)); i++) await sleep(500);
  await ev(`document.querySelectorAll("#chain-out .chain-tbl")[1].scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(1400);
  await point("#chain-out .chain-tbl:nth-of-type(2) tr:nth-child(5)", 0.6, 0.5); await sleep(6000);
  await point("#chain-out .chain-tbl:nth-of-type(2) tr:nth-child(5)", 0.95, 0.5);
});
const chainTxt = await ev(`document.getElementById("chain-out").innerText`);
console.log(chainTxt.split("\n").filter((l) => /PASS|FAIL|Round/.test(l)).join("\n"));
if (/FAIL/.test(chainTxt) || !/PASS/.test(chainTxt)) throw new Error("the on-chain check did not pass; not encoding");

}
// voting: the board's proposals on the finished demo, then the token contract
if (PART !== "head") {
await narrate(N.review, async () => {
  await point("#pre-demo", 0.5, 0.5); await click("#pre-demo");
  await waitFor(`!!document.querySelector("#proposal-4")`);
  await ev(`document.getElementById("proposal-4").scrollIntoView({behavior:"smooth",block:"start"})`); await sleep(1600);
  await point("#proposal-4 .rv-h", 0.5, 0.5); await sleep(5000);
  await point("#proposal-4 table", 0.5, 0.4); await sleep(4500);
  await ev(`document.getElementById("proposal-9").scrollIntoView({behavior:"smooth",block:"start"})`); await sleep(1600);
  await point("#proposal-9 .rv-h", 0.5, 0.5); await sleep(3500); await point("#proposal-9 table", 0.5, 0.4);
});
const reviewTxt = await ev(`document.getElementById("review-body").innerText`);
if (/DOES NOT MATCH/.test(reviewTxt) || !/VERIFIED/.test(reviewTxt)) throw new Error("the review card did not verify the demo's proposals");
await narrate(N.tokens, async () => {
  await ev(`document.getElementById("contract").scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(1300);
  await click("#contract"); // typed one letter at a time, so the viewer sees an account being entered
  for (let i = 1; i <= "rounds-tok-332657.testnet".length; i++) { await ev(`document.getElementById("contract").value=${JSON.stringify("rounds-tok-332657.testnet".slice(0, i))}`); await sleep(55); }
  await sleep(500); await click("#chain-btn");
  await waitFor(`!!document.querySelector("#proposal-14")`);
  await ev(`document.getElementById("proposal-14").scrollIntoView({behavior:"smooth",block:"start"})`); await sleep(1600);
  await point("#proposal-14 .rv-h", 0.5, 0.5); await sleep(4000); await point("#proposal-14 table", 0.5, 0.4); await sleep(5000);
  await point("#proposal-14 .rv-f", 0.5, 0.5);
});

await ev(`window.scrollTo({top:0,behavior:"smooth"})`); await sleep(1200);
await narrate(N.close2, async () => { await point("h1", 0.4, 0.5); });
await sleep(800);
}

// ---- encode ----
await send("Page.stopScreencast"); await sleep(300); ws.close(); chrome.kill();
const end = performance.now(); const list = [];
frames.forEach((fr, i) => { const d = ((frames[i + 1]?.t ?? end) - fr.t) / 1000; list.push(`file '${fr.f}'\nduration ${Math.max(d, 0.01).toFixed(3)}`); });
list.push(`file '${frames.at(-1).f}'`);
writeFileSync(join(work, "list.txt"), list.join("\n"));
const silent = join(work, "silent.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(work, "list.txt"), "-vf", `fps=25,scale=${W}:${H},format=yuv420p`, "-c:v", "libx264", "-crf", "23", silent]);
const ins = voice.flatMap((v) => ["-i", v.wav]);
const filt = voice.map((v, i) => `[${i + 1}:a]adelay=${Math.round(v.at * 1000)}:all=1[a${i}]`).join(";") + ";" + voice.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${voice.length}:normalize=0[aud]`;
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, ...ins, "-filter_complex", filt, "-map", "0:v", "-map", "[aud]", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", OUT]);
console.log(`wrote ${OUT} from ${frames.length} frames`);
process.exit(0);
