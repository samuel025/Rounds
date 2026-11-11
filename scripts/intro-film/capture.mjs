import { launch } from "./cdp.mjs";
import { writeFileSync } from "node:fs";
const URL_ = process.argv[2] ?? "https://roundcap.vercel.app/";
const b = await launch({ dpr: 2, w: 1440, h: 900 });
await b.send("Page.navigate", { url: URL_ }); await b.sleep(7000);
// scroll through once so lazy content and scroll animations finish, then reset
await b.ev(`(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 400) { scrollTo(0, y); await new Promise(r => setTimeout(r, 150)); } scrollTo(0, document.documentElement.scrollHeight); await new Promise(r => setTimeout(r, 800)); scrollTo(0, 0); await new Promise(r => setTimeout(r, 1200)); })()`);
// make the page static: nav in flow, no toasts, no animation
await b.ev(`(() => { const s = document.createElement("style"); s.textContent = ".nav{position:static!important} #toast,#rc{display:none!important} *{animation:none!important;transition:none!important;caret-color:transparent}"; document.head.appendChild(s); document.querySelectorAll("details").forEach(d => d.removeAttribute("open")); })()`);
await b.sleep(800);
const SEL = ["#intro", ".hero-chart", "#zk-run", "#cap .card", "#form", "#model-out", "#plan-card", "#flow", "#investor", "#employee", "#exit-card", "#share-card", "#share-run", "#chain-card", "#review", "#verify > .wrap > .card:last-of-type, #verify .card:last-of-type"];
const meta = await b.ev(`(() => { const out = []; const seen = new Set(); const take = (e, kind) => { if (!e || seen.has(e) || !e.offsetParent) return; const r = e.getBoundingClientRect(); if (r.height < 40) return; seen.add(e); e.setAttribute("data-layer", String(out.length)); out.push({ i: out.length, kind, x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, id: e.id || e.className.slice(0, 24) }); };
  for (const s of ${JSON.stringify(SEL)}) for (const e of document.querySelectorAll(s)) take(e, "card");
  for (const e of document.querySelectorAll(".hero .cta a")) take(e, "chip");
  const brand = document.querySelector(".brand .dot"); const bb = brand?.getBoundingClientRect();
  const hero = document.querySelector(".hero").getBoundingClientRect();
  return JSON.stringify({ H: document.documentElement.scrollHeight, W: document.documentElement.clientWidth, heroBottom: hero.bottom + scrollY, layers: out, dot: bb ? [bb.left, bb.top, bb.width, bb.height] : null }); })()`);
const M = JSON.parse(meta); console.log("H", M.H, "layers", M.layers.length, M.layers.map(l => l.id + ":" + Math.round(l.y)).join(" "));
// 1. the page with the layers hidden, in tiles of at most 4096 css px
await b.ev(`document.querySelectorAll("[data-layer]").forEach(e => e.style.visibility = "hidden")`);
const TILE = 4000; M.tiles = [];
for (let y = 0, n = 0; y < M.H; y += TILE, n++) {
  const h = Math.min(TILE, M.H - y);
  const r = await b.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y, width: 1440, height: h, scale: 1 } });
  writeFileSync(`assets/page-${n}.png`, Buffer.from(r.result.data, "base64")); M.tiles.push({ n, y, h });
}
await b.ev(`document.querySelectorAll("[data-layer]").forEach(e => e.style.visibility = "")`);
// 2. each layer alone, transparent, 28px padding
await b.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
await b.ev(`(() => { const s = document.createElement("style"); s.id = "solo"; document.head.appendChild(s); document.documentElement.style.background = "transparent"; document.body.style.background = "transparent"; })()`);
const PAD = 28;
for (const l of M.layers) {
  await b.ev(`document.getElementById("solo").textContent = "*{visibility:hidden!important} [data-layer='${l.i}'], [data-layer='${l.i}'] *{visibility:visible!important}"`);
  const r = await b.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: l.x - PAD, y: l.y - PAD, width: l.w + 2 * PAD, height: l.h + 2 * PAD, scale: 1 } });
  writeFileSync(`assets/layer-${l.i}.png`, Buffer.from(r.result.data, "base64"));
}
M.pad = PAD; writeFileSync("assets/meta.json", JSON.stringify(M, null, 1));
b.close(); process.exit(0);
