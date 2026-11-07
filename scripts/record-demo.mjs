// Records a captioned walkthrough of the web app: node scripts/record-demo.mjs [url] [out.mp4]
// Drives headless Chrome over the DevTools protocol, shows a fake cursor + captions, encodes with ffmpeg.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.argv[2] ?? "http://127.0.0.1:5173/";
const OUT = process.argv[3] ?? "demo/rounds-demo.mp4";
const W = 1280, H = 800, PORT = 9333;
const work = join(process.env.REC_DIR ?? tmpdir(), "rounds-rec"); rmSync(work, { recursive: true, force: true }); mkdirSync(work, { recursive: true });
mkdirSync("demo", { recursive: true });

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
await send("Page.navigate", { url: URL_ }); await sleep(2500);

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
  const t = document.createElement("div"); t.id = "title"; t.innerHTML = '<h1>Rounds</h1><p>The cap table that shows its work</p><p style="font-size:18px">Cap table and fundraising on NEAR testnet</p>'; document.body.appendChild(t);
})()`);

await send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: W, maxHeight: H, everyNthFrame: 1 });

const voice = []; let t0 = null;
const EDGE = process.env.EDGE_TTS ?? "edge-tts", VOICE = process.env.VOICE ?? "en-US-AndrewMultilingualNeural";
// One continuous voice clip per scene; the cursor actions run WHILE it plays, so the speech never stops and restarts.
const narrate = async (text, actions = async () => {}) => {
  const cache = join(process.env.REC_DIR ?? tmpdir(), "tts-cache"); mkdirSync(cache, { recursive: true });
  const mp3 = join(cache, createHash("sha1").update(VOICE + text).digest("hex") + ".mp3");
  if (!existsSync(mp3)) execFileSync(EDGE, ["--voice", VOICE, "--rate=-2%", "--text", text, "--write-media", mp3], { stdio: "ignore" });
  const dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3]).toString()) * 1000;
  voice.push({ wav: mp3, at: (performance.now() - (frames[0]?.t ?? performance.now())) / 1000 });
  const t0 = performance.now();
  await actions();
  await sleep(Math.max(300, dur - (performance.now() - t0)) + 350); // let the sentence finish, then a natural beat
};
const quiet = async () => {};
const rect = async (sel, fx = 0.5, fy = 0.5) => { for (let i = 0; i < 20 && !(await ev(`!!document.querySelector(${JSON.stringify(sel)})`)); i++) await sleep(250); return rect0(sel, fx, fy); };
const rect0 = (sel, fx = 0.5, fy = 0.5) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw new Error("no "+${JSON.stringify(sel)});const b=e.getBoundingClientRect();return [b.left+b.width*${fx},b.top+b.height*${fy}]})()`);
const scrollTo = async (sel, block = "start") => { await quiet(); await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({behavior:"smooth",block:${JSON.stringify(block)}})`); await sleep(1200); };
let cur = [640, 400];
const moveXY = async (x, y, ms = 900) => { cur = [x, y]; await ev(`document.getElementById("rc").style.transform="translate(${x}px,${y}px)"`); await sleep(ms + 100); };
const point = async (sel, fx, fy, ms) => { const [x, y] = await rect(sel, fx, fy); await moveXY(x, y, ms); };
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

process.on("uncaughtException", async (e) => { try { console.log("DIAG", await ev(`JSON.stringify({u:location.href,n:document.querySelectorAll("[id]").length,t:!!document.getElementById("cap-table"),y:scrollY})`)); } catch {} console.log(String(e.message).slice(0,200)); chrome.kill(); process.exit(1); });
// ---- script ----
await sleep(2200);
await ev(`document.getElementById("title").style.opacity=0`); await sleep(900); await ev(`document.getElementById("title").remove()`);
// warm up the wallet selector (it loads lazily) so the modal opens instantly during the narration
await click("#wallet-btn");
for (let i = 0; i < 40 && !(await ev(`[...document.querySelectorAll("*")].some(e=>e.children.length===0&&/Connect Your Wallet/.test(e.textContent)&&e.offsetParent!==null)`)); i++) await sleep(500);
await ev(`(()=>{const c=[...document.querySelectorAll('[class*="close"]')].find(e=>e.offsetParent!==null);if(c)c.click()})()`); await sleep(1200);
await ev(`window.scrollTo(0,0)`); await sleep(600);
const closeModal = () => ev(`(()=>{const c=[...document.querySelectorAll('[class*="close"]')].find(e=>e.offsetParent!==null);if(c)c.click()})()`);

await narrate("This is Rounds, a cap table and fundraising tool built on NEAR testnet, so there is no real money involved. The idea is simple: every number on a cap table should come with a way to check it. What you are looking at is a Series A, showing who owns what before and after the round, along with the price per share, which is solved exactly, in whole shares, with no floating point.", async () => {
  await sleep(3000); await point("h1", 0.4, 0.5); await sleep(5200); await point("#hero-bars", 0.5, 0.35); await sleep(5200); await point("#hero-price", 0.5, 0.5);
});

await narrate("Up in the corner, you can connect a NEAR testnet wallet. It opens the wallet selector, with MyNearWallet and Meteor, and the app never asks for a key. Every action you take here is approved in your own wallet.", async () => {
  await point("#wallet-btn", 0.5, 0.5); await sleep(1500); await click("#wallet-btn"); await sleep(5200); await closeModal(); await sleep(500);
});

await scrollTo("#cap");
await narrate("Next, the cap table. Every figure comes from a deterministic engine, never from an AI model, and each one links back to its definition in the rules file.", async () => {
  await point("#cap-table", 0.5, 0.3); await sleep(2500); await point("#cap-table", 0.5, 0.75, 1000);
});

await scrollTo("#model");
await narrate("The round modeler is where you can play with the numbers. Change an input, say a bigger cheque from the fund, and the engine instantly re-solves the SAFE conversions, the option pool and the price, and reports every rounding remainder. Then make the option pool larger, and the price drops, because the pool dilutes the existing holders, not the new investor.", async () => {
  await point("#form", 0.5, 0.1); await sleep(2800); await typeInto("#raise", 12000000); await point("#model-out", 0.5, 0.25); await sleep(5200); await typeInto("#pool", 15); await sleep(1500);
});

await narrate("Each round becomes a plan with its own SHA-256 hash. The board approves that hash, and the contract only runs a plan that matches it. And here is the button for it. With a wallet connected, this sends the round to the contract. Only an officer account is allowed to propose it, and after that the board votes on the hash.", async () => {
  await point("#plan-card", 0.5, 0.15); await sleep(5200);
  await ev(`document.getElementById("propose-btn").scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(1400);
  await point("#propose-btn", 0.5, 0.5); await sleep(1200);
  await point("#propose-btn", 0.45, 0.55, 500); await point("#propose-btn", 0.55, 0.45, 500);
});

await scrollTo("#people");
await narrate("Investors and employees get a personal view. Employee options vest over forty eight months, with a twelve month cliff, and as you drag through time, the vested amount is computed exactly.", async () => {
  await point("#investor", 0.5, 0.5); await sleep(3000); await point("#month", 0.1, 0.5); await sleep(600); await drag("#month", 0.05, 0.6);
});

await scrollTo("#exit");
await narrate("The exit simulator shows how proceeds are split. Preferred shareholders take their preference, or convert to common, whichever pays more. At a low exit the investor is paid first, and at a high exit everyone converts, and the payouts always add up to the proceeds.", async () => {
  await sleep(2500); await drag("#proceeds", 0.05, 0.2, 18); await sleep(3500); await drag("#proceeds", 0.2, 0.9, 30);
});

await scrollTo("#verify");
await narrate("Now, the part that matters: checking everything against the real chain. You can paste any Rounds contract on testnet. This one is our demo contract, and the app reads the cap table, the rounds and the exits straight from the chain. Each round's plan is hashed again, right here in your browser, and compared with the hash the chain holds. A pass means they are identical, and every round has its own link, so an investor can open a single address that proves their round.", async () => {
  await point("#contract", 0.4, 0.5); await sleep(2500); await click("#chain-btn");
  for (let i = 0; i < 60 && !(await ev(`!!document.querySelector("#chain-out .chain-tbl")`)); i++) await sleep(500);
  await point("#chain-out .chain-tbl", 0.5, 0.5); await sleep(4000);
  await ev(`document.querySelectorAll("#chain-out .chain-tbl")[1].scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(1400);
  await point("#chain-out .chain-tbl:nth-of-type(2) tr:nth-child(3)", 0.6, 0.5); await sleep(4500);
  await point("#chain-out .chain-tbl:nth-of-type(2) tr:nth-child(3)", 0.95, 0.5);
});

await narrate("Once a wallet is connected, this panel shows what your account can do on the contract: get test tokens, fund a round, close it, pay out an exit, or vote if you are on the board. And the Verify button recomputes everything against the engine and the chain one more time.", async () => {
  await ev(`document.getElementById("chain-actions").scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(1400);
  await point("#chain-actions", 0.3, 0.5); await sleep(6500);
  await ev(`document.getElementById("verify-btn").scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(1400);
  await click("#verify-btn");
  for (let i = 0; i < 60; i++) { const t = await ev(`document.getElementById("verify-out").textContent`); if (/failed/.test(t)) break; await sleep(500); }
});
await ev(`document.getElementById("verify-out").scrollIntoView({behavior:"smooth",block:"center"})`); await sleep(1200);
const outTxt = await ev(`document.getElementById("verify-out").textContent`);
console.log(outTxt);
if (!/0 failed/.test(outTxt)) throw new Error("Verify did not finish with 0 failed; not encoding");
await narrate("Every check passes, and the hashes match the chain. Rounds is testnet only, with an exact equity engine, a second implementation, and a verifier anyone can run. Thanks for watching.", async () => {
  await point("#verify-out", 0.3, 0.3);
});
await sleep(800);

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
