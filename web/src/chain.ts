// Read any Rounds contract straight from a NEAR RPC and re-verify it in the browser. No events file, no wallet.
import { planHash } from "../../src/engine/index";

export interface RoundRec { id: number; kind: unknown; status: string; plan_hash: string; plan_uri: string; plan: string; raise: [string, string][]; deposits: [string, string][] }
export interface ExitRec { id: number; plan_hash: string; plan_uri: string; approved: boolean; total: string; funded: string; payouts: { account?: string; amount?: string; paid?: boolean }[] }
export interface ChainView {
  contract: string; board: string; token: string; classes: { id: string; authorized: string }[];
  holdings: [string, string, string][]; rounds: RoundRec[]; exits: ExitRec[];
}
export const validAccount = (s: string) => /^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/.test(s) && s.length >= 2;
export const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export async function call(rpc: string, account: string, method: string, args: object) {
  const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: account, method_name: method, args_base64: btoa(JSON.stringify(args)) } }) });
  const j = await res.json();
  if (j.error || j.result?.error) throw new Error(String(j.error?.data ?? j.result?.error ?? j.error?.message ?? "rpc error").slice(0, 160));
  return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
}

export async function loadChain(rpc: string, contract: string, max = 50): Promise<ChainView> {
  if (!validAccount(contract)) throw new Error("not a valid NEAR account id");
  const [board, token, classes] = await call(rpc, contract, "config", {});
  const holdings: [string, string, string][] = [];
  for (let from = 0; ; from += 100) { const page = await call(rpc, contract, "cap_table", { from, limit: 100 }); holdings.push(...page); if (page.length < 100 || from > 1000) break; }
  const rounds: RoundRec[] = []; for (let i = 1; i <= max; i++) { const r = await call(rpc, contract, "round", { round_id: i }); if (!r) break; rounds.push(r); }
  const exits: ExitRec[] = []; for (let i = 1; i <= max; i++) { const e = await call(rpc, contract, "exit", { exit_id: i }); if (!e) break; exits.push(e); }
  return { contract, board, token, classes, holdings, rounds, exits };
}

// Recompute a round's plan hash locally and compare with the one the chain holds.
export async function checkRound(r: RoundRec) {
  const local = await planHash(r.plan);
  return { ok: local === r.plan_hash, local };
}
