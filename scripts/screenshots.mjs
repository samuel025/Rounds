// Takes the README's screenshots from the running app (needs `make web-dev` on port 5173, Chrome, network for the chain reads): node scripts/screenshots.mjs
// Run with: npx vite-node scripts/screenshots.mjs
// One headless Chrome, one shot at a time. Element shots are cropped to the element; the sticky bars are made static so they do not float over it.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeDraft } from "../src/engine/draft";

const APP = process.argv[2] ?? "http://127.0.0.1:5173/", OUT = "docs/img", PORT = 9611, W = 1280, H = 900;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn("google-chrome", ["--headless=new", `--remote-debugging-port=${PORT}`, `--window-size=${W},${H}`, "--hide-scrollbars", "--force-dark-mode", "--disable-gpu", "--renderer-process-limit=1", "--no-first-run", `--user-data-dir=${mkdtempSync(join(tmpdir(), "shots-"))}`, "about:blank"], { stdio: "ignore" });
let t; for (let i = 0; i < 50; i++) { try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((x) => x.type === "page"); if (t) break; } catch {} await sleep(200); }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });

async function open(url, wait = 6000) { await send("Page.navigate", { url }); await sleep(wait); }
async function save(name, clip) { const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }); writeFileSync(join(OUT, name), Buffer.from(r.result.data, "base64")); console.log("wrote", name); }
/** crop to the union of the given elements, with a little margin */
async function shotEl(name, sels, margin = 14) {
  await ev(`(()=>{const s=document.createElement("style");s.textContent=".nav,#rolebar{position:static!important}#toast{display:none!important}";document.head.appendChild(s)})()`);
  await ev(`document.querySelector(${JSON.stringify(sels[0])}).scrollIntoView({block:"start"})`); await sleep(700);
  const r = await ev(`(()=>{let x0=1e9,y0=1e9,x1=0,y1=0;for(const s of ${JSON.stringify(sels)}){const e=document.querySelector(s);if(!e)continue;const b=e.getBoundingClientRect();x0=Math.min(x0,b.left);y0=Math.min(y0,b.top+scrollY);x1=Math.max(x1,b.right);y1=Math.max(y1,b.bottom+scrollY)}return [x0,y0,x1,y1]})()`);
  await save(name, { x: Math.max(0, r[0] - margin), y: Math.max(0, r[1] - margin), width: Math.min(W, r[2] - r[0] + 2 * margin), height: r[3] - r[1] + 2 * margin });
}
const setRole = (role) => ev(`document.querySelector('#rolebar [data-role="${role}"]')?.click()`);

try {
  // 1. the top of the page, with the role bar
  await open(APP); await ev(`window.scrollTo(0,0)`); await sleep(500); await save("01-home.png", { x: 0, y: 0, width: W, height: 820 });
  // 2. the round modeler: numbers in, price and ownership out, the plan hash the board votes on
  await shotEl("02-modeler.png", ["#model"]);
  // 3. a draft link: two named investors, a deadline, and their sign-off table
  const draft = await encodeDraft({ v: 1, pre: 30_000_000, raise: 10_000_000, pool: 12, ada: 5_000_000, bayo: 2_750_000, poolNow: 1_000_000, confidential: false, note: "v2 after the call: lead wants a 12% pool",
    safes: [{ id: "safe1", holder: "chidi", amt: 500_000, cap: 5_000_000, disc: 0 }, { id: "safe2", holder: "dayo", amt: 250_000, cap: 10_000_000, disc: 0 }],
    allocs: [{ holder: "lead.testnet", bps: 6000 }, { holder: "fund.testnet", bps: 4000 }], deadline: 1_800_000_000 });
  // a finished sandbox is pinned so the page does not lock itself to a fresh sandbox company (which would ignore the named investors)
  await open(`${APP}?sandbox=rsbx-rounds-143672.testnet&contract=rounds-core-332657.testnet#${draft}`, 12000);
  for (let i = 0; i < 60 && !/Plan hash/.test(await ev(`document.getElementById("signoff-card")?.textContent ?? ""`)); i++) await sleep(1500); // the card fills in once the contract has been read
  await ev(`(()=>{for(const p of document.querySelectorAll("#draft-card p.mono"))p.textContent=p.textContent.split("http://127.0.0.1:5173/").join("https://roundcap.vercel.app/")})()`);
  await shotEl("03-draft-signoff.png", ["#draft-card", "#signoff-card"]);
  // 4. confidential mode: the steps, and what stays private
  for (let tries = 0; tries < 6; tries++) { // a transient RPC failure would otherwise be photographed
    await open(APP, 9000);
    if (/Confidential sandbox/.test(await ev(`document.getElementById("zk-banner")?.textContent ?? ""`)) && !/Could not read/.test(await ev(`document.getElementById("zk-banner")?.textContent ?? ""`))) break;
  }
  await ev(`document.querySelector("#zk details.zd summary")?.click()`); await shotEl("04-confidential.png", ["#zk"]);
  } catch (e) { console.log("shot failed:", e.message); }
  try {
  // 5. the board's view of a vote: decoded, re-checked, with the before/after ownership bars
  await open(`${APP}?contract=rounds-core-332657.testnet#review`, 8000);
  for (let i = 0; i < 40 && !(await ev(`!!document.querySelector("#review-body .rv")`)); i++) await sleep(1500); // the chain read can be slow
  if (!(await ev(`!!document.querySelector("#review-body .rv")`))) throw new Error("no proposals rendered: " + (await ev(`document.getElementById("review-body")?.innerText.slice(0,200)`)));
  await setRole("board"); await sleep(600);
  await ev(`document.querySelectorAll("#review-body details.gloss").forEach((d) => (d.open = true))`); await sleep(500);
  await ev(`(()=>{const e=document.querySelector("#review-body .rv:has(.diff)")||document.querySelector("#review-body .rv");e?.setAttribute("id","shot-rv")})()`);
  await shotEl("05-board-vote.png", ["#shot-rv"]);
  } catch (e) { console.log("shot 5 failed:", e.message); }
  try {
  // 6. the investor view
  await open(APP); await setRole("investor"); await sleep(600); await shotEl("06-investor.png", ["#people"]);
} catch (e) { console.log("FAILED", e.message); }
chrome.kill(); process.exit(0);
