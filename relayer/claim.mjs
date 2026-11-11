// Claim relayer for Rounds' confidential mode: takes a holder's proof, checks it locally, and submits `claim_private_payout` from its OWN account,
// paying the gas. The holder's wallet never appears on chain. The proof and its public inputs carry no secret; the relayer learns the recipient,
// the exit and the amount (all public on chain anyway) and the requester's network address (a privacy cost of using any relayer: run your own).
// Abuse limits: it verifies the proof off chain first (an invalid proof costs nothing), only calls the one configured contract and method,
// and rate-limits per requester.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as snarkjs from "snarkjs";
import { Account, KeyPairSigner, providers } from "near-api-js";

const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const dec = /^[0-9]{1,78}$/, acct = /^[a-z0-9._-]{2,64}$/;
const hits = new Map();

export function loadConfig(env = process.env) {
  const need = (k) => { if (!env[k]) throw new Error(`relayer: set ${k}`); return env[k]; };
  let key = env.RELAYER_PRIVATE_KEY;
  if (!key && env.RELAYER_CREDENTIALS) key = JSON.parse(readFileSync(env.RELAYER_CREDENTIALS, "utf8")).private_key;
  if (!key) throw new Error("relayer: set RELAYER_PRIVATE_KEY (ed25519:...) or RELAYER_CREDENTIALS (a near-cli credentials file)");
  return { rpc: env.RPC_URL ?? "https://test.rpc.fastnear.com", contract: need("RELAYER_CONTRACT"), account: need("RELAYER_ACCOUNT"), privateKey: key,
    vkeyPath: env.RELAYER_VKEY ?? "web/public/zk/private_claim_verification_key.json", perMinute: Number(env.RELAYER_PER_MINUTE ?? 6) };
}

async function view(cfg, method, args) {
  const r = await (await fetch(cfg.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: cfg.contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }) })).json();
  if (r.error || r.result?.error) throw new Error(`could not read ${method}`);
  return JSON.parse(Buffer.from(r.result.result).toString());
}
const recipientHash = (id) => (BigInt("0x" + createHash("sha256").update(id).digest("hex")) % R).toString();
const asSnark = (p) => ({ pi_a: [...p.a, "1"], pi_b: [p.b[0], p.b[1], ["1", "0"]], pi_c: [...p.c, "1"], protocol: "groth16", curve: "bn128" });

/** Validates and relays one claim. Returns { status, body }. */
export async function relayClaim(body, cfg, who = "anon") {
  const t = Date.now(), recent = (hits.get(who) ?? []).filter((x) => t - x < 60_000);
  if (recent.length >= cfg.perMinute) return { status: 429, body: { ok: false, error: "too many claims from this address; try again in a minute" } };
  hits.set(who, [...recent, t]);
  const b = body ?? {};
  const okShape = Number.isInteger(b.exit_id) && b.exit_id > 0 && dec.test(b.nullifier ?? "") && dec.test(b.payout_amount ?? "") && acct.test(b.recipient_id ?? "")
    && Array.isArray(b.proof?.a) && Array.isArray(b.proof?.b) && Array.isArray(b.proof?.c) && [...b.proof.a, ...b.proof.c, ...b.proof.b.flat()].every((x) => typeof x === "string" && dec.test(x)) && b.proof.a.length === 2 && b.proof.c.length === 2 && b.proof.b.length === 2;
  if (!okShape) return { status: 400, body: { ok: false, error: "malformed claim" } };
  let exit, root;
  try { exit = await view(cfg, "private_exit", { exit_id: b.exit_id }); root = exit ? await view(cfg, "confidential_root", { round_id: exit.round_id }) : null; } catch (e) { return { status: 502, body: { ok: false, error: e.message } }; }
  if (!exit || !root) return { status: 404, body: { ok: false, error: "no such private payout" } };
  if (!exit.approved) return { status: 409, body: { ok: false, error: "that payout is not approved yet" } };
  if (await view(cfg, "nullifier_used", { nullifier: b.nullifier })) return { status: 409, body: { ok: false, error: "this receipt has already been claimed (ERR_NULLIFIER_USED)" } };
  const publicSignals = [root[0], b.nullifier, String(b.exit_id), exit.total_shares, exit.pot, b.payout_amount, recipientHash(b.recipient_id)];
  let valid = false;
  try { valid = await snarkjs.groth16.verify(JSON.parse(readFileSync(cfg.vkeyPath, "utf8")), publicSignals, asSnark(b.proof)); } catch { valid = false; }
  if (!valid) return { status: 422, body: { ok: false, error: "the proof does not verify for these values (nothing was sent)" } };
  try {
    const signer = KeyPairSigner.fromSecretKey(cfg.privateKey);
    const account = new Account(cfg.account, new providers.JsonRpcProvider({ url: cfg.rpc }), signer);
    const out = await account.callFunction({ contractId: cfg.contract, methodName: "claim_private_payout", args: { exit_id: b.exit_id, nullifier: b.nullifier, payout_amount: b.payout_amount, recipient_id: b.recipient_id, proof: b.proof }, gas: 300_000_000_000_000n, waitUntil: "FINAL" });
    void out;
    return { status: 200, body: { ok: true, relayer: cfg.account } };
  } catch (e) { return { status: 502, body: { ok: false, error: String(e.message ?? e).slice(0, 300) } }; }
}
