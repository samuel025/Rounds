// make relayer: a local claim relayer on http://127.0.0.1:8787/relay-claim (the same code as the Vercel function in api/relay-claim.js).
//   RELAYER_ACCOUNT=<funded testnet account> RELAYER_CREDENTIALS=~/.near-credentials/testnet/<it>.json RELAYER_CONTRACT=<confidential contract> node scripts/relayer.mjs
import { createServer } from "node:http";
import { loadConfig, relayClaim } from "../relayer/claim.mjs";
const cfg = loadConfig(), PORT = Number(process.env.PORT ?? 8787);
createServer(async (req, res) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS", "content-type": "application/json" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  if (req.method !== "POST" || !req.url?.startsWith("/relay-claim")) { res.writeHead(404, cors); return res.end(JSON.stringify({ ok: false })); }
  let raw = ""; for await (const c of req) { raw += c; if (raw.length > 20_000) break; }
  let body = null; try { body = JSON.parse(raw); } catch { /* handled as malformed */ }
  const r = await relayClaim(body, cfg, req.socket.remoteAddress ?? "anon");
  res.writeHead(r.status, cors); res.end(JSON.stringify(r.body));
}).listen(PORT, "127.0.0.1", () => console.log(`relayer for ${cfg.contract} paying gas from ${cfg.account} on http://127.0.0.1:${PORT}/relay-claim`));
