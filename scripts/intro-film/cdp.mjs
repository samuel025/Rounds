import { spawn } from "node:child_process";
export async function launch({ port = 9811, w = 1440, h = 900, dpr = 1, flags = [] } = {}) {
  const c = spawn("google-chrome", ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--hide-scrollbars", `--window-size=${w},${h}`, `--user-data-dir=/tmp/film-prof-${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", ...flags, "about:blank"], { stdio: "ignore" });
  let t; for (let i = 0; i < 60; i++) { try { t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x => x.type === "page"); if (t) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const p = new Map();
  ws.onmessage = m => { const j = JSON.parse(m.data); if (j.id && p.has(j.id)) { p.get(j.id)(j); p.delete(j.id); } else if (j.method === 'Runtime.exceptionThrown') console.log('PAGE EXC', JSON.stringify(j.params.exceptionDetails).slice(0, 700)); else if (j.method === 'Runtime.consoleAPICalled' && process.env.CONSOLE) console.log('PAGE', j.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 400)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result?.result?.value; };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
  return { send, ev, close: () => { ws.close(); c.kill(); }, sleep: (ms) => new Promise(r => setTimeout(r, ms)) };
}
