// node render.mjs stills 0,1.6,2.5   |   node render.mjs frames [fps] [from] [to]
import { launch } from "./cdp.mjs";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { extname, join } from "node:path";
const mode = process.argv[2], DIR = process.cwd();
const srv = createServer((q, r) => { const f = join(DIR, decodeURIComponent(q.url.split("?")[0]).replace(/^\/$/, "/index.html")); if (!existsSync(f)) { r.statusCode = 404; return r.end(); } r.setHeader("content-type", { ".html": "text/html", ".png": "image/png", ".json": "application/json" }[extname(f)] ?? "application/octet-stream"); r.end(readFileSync(f)); }).listen(8923 + +(process.env.OFF ?? 0));
const sub = process.env.SUB ?? "5";
const b = await launch({ port: 9833 + +(process.env.OFF ?? 0), w: 1440, h: 1152, dpr: 1 });
b.send("Runtime.enable");
await b.send("Page.navigate", { url: `http://127.0.0.1:${8923 + +(process.env.OFF ?? 0)}/?an=${process.env.AN ?? 16}&sub=${sub}${process.env.DBG ? "&dbg=1" : ""}${process.env.NOSH ? "&nosh=1" : ""}` });
for (let i = 0; i < 240 && !(await b.ev("window.ready === true").catch(() => false)); i++) await b.sleep(500);
if (!(await b.ev("window.ready === true"))) throw new Error("film page never became ready");
const shot = async (t, file, fmt = "png") => { const a0 = Date.now(); await b.ev(`seek(${t})`); await b.ev(`(()=>{const g=document.getElementById("c").getContext("webgl2"); const p=new Uint8Array(4); g.readPixels(0,0,1,1,g.RGBA,g.UNSIGNED_BYTE,p); return 1})()`); if (process.env.TIMING) console.log("seek+sync", Date.now() - a0, "ms"); const r = await b.send("Page.captureScreenshot", { format: fmt, quality: 93, clip: { x: 0, y: 0, width: 1440, height: 1152, scale: 1 } }); writeFileSync(file, Buffer.from(r.result.data, "base64")); };
if (mode === "stills") { mkdirSync("stills", { recursive: true }); for (const t of process.argv[3].split(",")) { const t0 = Date.now(); await shot(+t, `stills/s-${t}.png`); console.log("still", t, Date.now() - t0, "ms"); } }
else if (mode === "depth") { await b.ev(`seek(${process.argv[3]})`); console.log(await b.ev(`readDepth(720,[100,300,405,576,800,1000])`)); console.log(await b.ev(`info(${process.argv[3]})`).then(x=>JSON.parse(x).cam)); }
else if (mode === "info") { for (const t of process.argv[3].split(",")) console.log(await b.ev(`info(${t})`)); }
else { const fps = +(process.argv[3] ?? 30), from = +(process.argv[4] ?? 0), to = +(process.argv[5] ?? Math.round(14.5 * fps)); mkdirSync("frames", { recursive: true }); const t00 = Date.now(); for (let n = from; n < to; n++) { if (existsSync(`frames/f${String(n).padStart(5, "0")}.jpg`)) continue; await shot(n / fps, `frames/f${String(n).padStart(5, "0")}.jpg`, "jpeg"); if (n % 10 === 0) console.log("frame", n, "of", to, Math.round((Date.now() - t00) / 1000) + "s"); } }
b.close(); srv.close(); process.exit(0);
