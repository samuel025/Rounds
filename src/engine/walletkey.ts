// Keys and signatures that come from a NEAR wallet's message signature (NEP-413), so nothing has to be kept in a file:
//  - a holder's ZK secret and an encryption key are DERIVED from one fixed message the wallet signs. ed25519 signatures are
//    deterministic, so signing the same message again (a new browser, a cleared cache) gives the same signature and so the same keys;
//  - investor sign-offs and the board's wrapped keys use the same signing code.
// Pure functions: no DOM, no wallet. The wallet call itself lives in web/src/walletsign.ts.
// Honest limit: anyone who can get the wallet to sign this exact message (same recipient and nonce) gets the keys. The recipient is the
// app's own name, which the wallet shows; contract accounts and some hardware wallets cannot sign messages, so the manual key file stays.
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";

export const KEY_MESSAGE = "Rounds Cap Table Key v1";
export const KEY_RECIPIENT = "rounds-cap-table";
/** A fixed 32-byte nonce: NEP-413 wants one, and a fixed value is what makes the signature (and so the keys) repeatable. */
export const KEY_NONCE: Uint8Array = sha256(new TextEncoder().encode("rounds-cap-table-key-v1"));
export const SIGNOFF_RECIPIENT = "rounds-signoff";

const te = new TextEncoder();
export const toHex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (s: string): Uint8Array => { if (!/^([0-9a-f]{2})*$/i.test(s)) throw new Error("not hex"); return Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16)); };
export const toB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
export const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface Nep413 { message: string; nonce: Uint8Array; recipient: string; callbackUrl?: string }
const u32le = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const bstr = (s: string) => { const b = te.encode(s); return concat([u32le(b.length), b]); };
const concat = (parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

/** The bytes a NEP-413 wallet signs: sha256( u32le(2^31 + 413) ++ borsh({message, nonce, recipient, callbackUrl}) ). */
export function nep413Hash(p: Nep413): Uint8Array {
  if (p.nonce.length !== 32) throw new Error("a NEP-413 nonce is 32 bytes");
  const payload = concat([bstr(p.message), p.nonce, bstr(p.recipient), p.callbackUrl === undefined ? new Uint8Array([0]) : concat([new Uint8Array([1]), bstr(p.callbackUrl)])]);
  return sha256(concat([u32le(2_147_484_061), payload]));
}

export const parsePublicKey = (k: string): Uint8Array => { const m = /^ed25519:(.+)$/.exec(k); if (!m) throw new Error("only ed25519 keys sign messages"); const b = base58.decode(m[1]); if (b.length !== 32) throw new Error("bad public key length"); return b; };
export const formatPublicKey = (b: Uint8Array) => `ed25519:${base58.encode(b)}`;

/** Checks a NEP-413 signature (base64, as wallets return it) against a public key. It does NOT check that the key belongs to the account: do that on chain. */
export function verifyNep413(p: Nep413, signatureB64: string, publicKey: string): boolean {
  try { return ed25519.verify(fromB64(signatureB64), nep413Hash(p), parsePublicKey(publicKey)); } catch { return false; }
}

async function hkdf(ikm: Uint8Array, info: string, length = 32, salt = "rounds/v1"): Promise<Uint8Array> {
  const base = await globalThis.crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await globalThis.crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: te.encode(salt), info: te.encode(info) }, base, length * 8));
}
const bytesToBig = (b: Uint8Array) => b.reduce((a, x) => (a << 8n) | BigInt(x), 0n);

/** The holder's ZK secret, one per share class (a nullifier is Poseidon(secret, exit), so two classes need two secrets).
 *  31 bytes = 248 bits, always below the BN254 field, so no modular bias. Returned as a decimal string, the shape HolderKey uses. */
export async function deriveHolderSecret(signatureB64: string, shareClass: string): Promise<string> {
  const sig = fromB64(signatureB64); if (sig.length !== 64) throw new Error("an ed25519 signature is 64 bytes");
  return bytesToBig(await hkdf(sig, `holder-secret|${shareClass}`, 31)).toString();
}
/** An X25519 encryption key pair derived from the same signature (for sealed claim data and the board's wrapped keys). */
export async function deriveEncryptionKey(signatureB64: string): Promise<{ secretKey: Uint8Array; publicKey: Uint8Array }> {
  const sig = fromB64(signatureB64); if (sig.length !== 64) throw new Error("an ed25519 signature is 64 bytes");
  const secretKey = await hkdf(sig, "encryption-key", 32);
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}
