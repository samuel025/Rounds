// Vercel serverless function: the same claim relayer as scripts/relayer.mjs. Set these environment variables in the Vercel project:
//   RELAYER_ACCOUNT, RELAYER_PRIVATE_KEY (ed25519:...; a throwaway funded TESTNET key), RELAYER_CONTRACT (the confidential contract).
// Then add {"url": "/api/relay-claim"} as web/public/relayer.json so the page offers it.
import { loadConfig, relayClaim } from "../relayer/claim.mjs";
export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*"); res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  let cfg; try { cfg = loadConfig(); } catch (e) { return res.status(503).json({ ok: false, error: "the relayer is not configured" }); }
  const who = String(req.headers["x-forwarded-for"] ?? "anon").split(",")[0].trim();
  const r = await relayClaim(req.body, cfg, who);
  return res.status(r.status).json(r.body);
}
