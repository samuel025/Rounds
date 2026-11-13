// Investor sign-off: before a plan goes to the board, each holder with a NEAR account signs (NEP-413, off chain) a message that names the
// plan hash AND their own row. The hash covers kind, raise, deadline and issuances (RULES.md R9), so a change to any money term after
// someone signed makes their signature stop matching. The board then sees "7 of 9 confirmed", not a bare yes.
// This confirms an allocation row; it is not legal consent. Contract and multisig accounts cannot sign and are reported as such.
import { canonicalJson } from "./plan";
import { SIGNOFF_RECIPIENT, nep413Hash, verifyNep413, toB64, toHex, fromB64, type Nep413 } from "./walletkey";
import { sha256 } from "@noble/hashes/sha2.js";

export interface SignoffRow { account: string; lines: { class: string; shares: string }[]; pays?: string; holderCode?: string }
export interface Signoff { account: string; message: string; nonce: string; recipient: string; publicKey: string; signature: string }
export interface SignoffBundle { version: 1; contract: string; planHash: string; signoffs: Signoff[] }

const NEAR_ACCOUNT = /^(?=.{2,64}$)([a-z0-9]+[-_])*[a-z0-9]+(\.([a-z0-9]+[-_])*[a-z0-9]+)*$/;
/** Names in a plan that are real NEAR accounts. The unissued pool and free-text labels have nobody to sign. */
export const isSigner = (holder: string) => holder !== "unissued_pool" && NEAR_ACCOUNT.test(holder);

/** The rows of a plan, one per holder account: what that holder is issued and what they pay. Works for the plan JSON of a priced/safe/founder round. */
export function rowsOfPlan(planJson: string): { rows: SignoffRow[]; unsigned: string[] } {
  const p = JSON.parse(planJson);
  const by = new Map<string, SignoffRow>(); const unsigned = new Set<string>();
  const row = (h: string) => { let r = by.get(h); if (!r) { r = { account: h, lines: [] }; by.set(h, r); } return r; };
  for (const i of p.issuances ?? []) { if (!isSigner(i.holder)) { if (i.holder !== "unissued_pool") unsigned.add(i.holder); continue; } const r = row(i.holder); const l = r.lines.find((x) => x.class === i.class); if (l) l.shares = (BigInt(l.shares) + BigInt(i.shares)).toString(); else r.lines.push({ class: i.class, shares: String(i.shares) }); }
  for (const [who, amt] of p.raise ?? []) { if (!isSigner(who)) { unsigned.add(who); continue; } row(who).pays = String(amt); }
  const rows = [...by.values()]; for (const r of rows) r.lines.sort((a, b) => (a.class < b.class ? -1 : 1));
  return { rows: rows.sort((a, b) => (a.account < b.account ? -1 : 1)), unsigned: [...unsigned].sort() };
}

/** The exact text a holder signs. Canonical JSON, so the proposer and every verifier build the same bytes. */
export function signoffMessage(contract: string, planHash: string, row: SignoffRow): string {
  return canonicalJson({ app: "rounds", contract, kind: "signoff", planHash, row: { ...row, lines: [...row.lines].sort((a, b) => (a.class < b.class ? -1 : 1)) }, v: 1 });
}
/** The nonce is the message's own hash: unique per message, repeatable, and 32 bytes as NEP-413 wants. */
export const signoffNonce = (message: string) => sha256(new TextEncoder().encode(message));
export const signoffPayload = (message: string): Nep413 => ({ message, nonce: signoffNonce(message), recipient: SIGNOFF_RECIPIENT });

/** Wraps a wallet's answer into a bundle entry. */
export function toSignoff(account: string, message: string, publicKey: string, signatureB64: string): Signoff {
  return { account, message, nonce: toB64(signoffNonce(message)), recipient: SIGNOFF_RECIPIENT, publicKey, signature: signatureB64 };
}

export type RowStatus = { account: string; status: "confirmed" } | { account: string; status: "missing" } | { account: string; status: "invalid"; reason: string };
export interface SignoffReport { rows: RowStatus[]; confirmed: number; total: number; unsigned: string[]; all: boolean }

/** Checks a bundle against the rows the plan really has. `keyOnAccount` asks the chain whether a public key is a full-access key of the account. */
export async function evaluateSignoffs(bundle: SignoffBundle | null, expected: { rows: SignoffRow[]; unsigned: string[] }, contract: string, planHash: string, keyOnAccount: (account: string, publicKey: string) => Promise<boolean>): Promise<SignoffReport> {
  const rows: RowStatus[] = [];
  for (const r of expected.rows) {
    const s = bundle && bundle.contract === contract && bundle.planHash === planHash ? bundle.signoffs.find((x) => x.account === r.account) : undefined;
    if (!s) { rows.push({ account: r.account, status: "missing" }); continue; }
    const want = signoffMessage(contract, planHash, r);
    if (s.message !== want) { rows.push({ account: r.account, status: "invalid", reason: "signed a different row or plan than the one now proposed" }); continue; }
    const payload: Nep413 = { message: s.message, nonce: fromB64(s.nonce), recipient: SIGNOFF_RECIPIENT };
    if (toHex(payload.nonce) !== toHex(signoffNonce(s.message)) || s.recipient !== SIGNOFF_RECIPIENT) { rows.push({ account: r.account, status: "invalid", reason: "wrong nonce or recipient" }); continue; }
    if (!verifyNep413(payload, s.signature, s.publicKey)) { rows.push({ account: r.account, status: "invalid", reason: "the signature does not verify" }); continue; }
    let ok = false; try { ok = await keyOnAccount(r.account, s.publicKey); } catch { ok = false; }
    rows.push(ok ? { account: r.account, status: "confirmed" } : { account: r.account, status: "invalid", reason: "that key is not a full-access key of the account" });
  }
  const confirmed = rows.filter((x) => x.status === "confirmed").length;
  return { rows, confirmed, total: rows.length, unsigned: expected.unsigned, all: rows.length > 0 && confirmed === rows.length };
}

/** The bundle as the exact text committed on chain (sorted keys, signoffs ordered by account). The contract stores this text and logs its sha256. */
export function serializeBundle(b: SignoffBundle): string {
  return canonicalJson({ contract: b.contract, planHash: b.planHash, signoffs: [...b.signoffs].sort((x, y) => (x.account < y.account ? -1 : 1)).map((s) => ({ account: s.account, message: s.message, nonce: s.nonce, publicKey: s.publicKey, recipient: s.recipient, signature: s.signature })), version: b.version });
}
/** sha256 of the serialized bundle: equals the contract's `signoffs_hash_of`. */
export async function bundleHash(b: SignoffBundle): Promise<string> {
  return toHex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(serializeBundle(b)))));
}
/** Reads a bundle from chain text; anything malformed is null (it then counts as "no sign-offs"), never a crash. */
export function parseBundle(text: string | null): SignoffBundle | null {
  if (!text) return null;
  try {
    const j = JSON.parse(text); if (j?.version !== 1 || typeof j.contract !== "string" || typeof j.planHash !== "string" || !Array.isArray(j.signoffs)) return null;
    const ok = (s: any) => s && ["account", "message", "nonce", "recipient", "publicKey", "signature"].every((k) => typeof s[k] === "string");
    return { version: 1, contract: j.contract, planHash: j.planHash, signoffs: j.signoffs.filter(ok) };
  } catch { return null; }
}
