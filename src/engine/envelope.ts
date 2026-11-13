// Sealed data for named recipients (X25519 + HKDF + AES-GCM), no passphrase to share.
//  - encryptTo / decryptFrom: one message for one public key (a holder's sealed claim data);
//  - sealForMany / openEnvelope: one ciphertext and a copy of its content key wrapped for each recipient (the board's private table:
//    the body is stored once however many council members there are).
// The envelope's hash can be committed on chain, so the proposer cannot hand different members different tables afterwards.
import { x25519 } from "@noble/curves/ed25519.js";
import { toB64, fromB64, toHex } from "./walletkey";

const te = new TextEncoder(), td = new TextDecoder();
const rand = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const cat = (a: Uint8Array, b: Uint8Array) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };

async function aesKey(raw: Uint8Array, usage: KeyUsage[]) { return globalThis.crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, usage); }
async function wrapKey(shared: Uint8Array, epk: Uint8Array, rpk: Uint8Array) {
  const base = await globalThis.crypto.subtle.importKey("raw", shared as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await globalThis.crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: cat(epk, rpk) as BufferSource, info: te.encode("rounds-ecies-v1") }, base, 256);
  return aesKey(new Uint8Array(bits), ["encrypt", "decrypt"]);
}

export interface Sealed { epk: string; iv: string; ct: string }
/** Encrypts `plaintext` so only the holder of the private key for `recipientPublicKey` can read it. */
export async function encryptTo(recipientPublicKey: Uint8Array, plaintext: Uint8Array): Promise<Sealed> {
  const esk = rand(32), epk = x25519.getPublicKey(esk), iv = rand(12);
  const key = await wrapKey(x25519.getSharedSecret(esk, recipientPublicKey), epk, recipientPublicKey);
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plaintext as BufferSource));
  return { epk: toB64(epk), iv: toB64(iv), ct: toB64(ct) };
}
export async function decryptFrom(secretKey: Uint8Array, s: Sealed): Promise<Uint8Array> {
  const epk = fromB64(s.epk), rpk = x25519.getPublicKey(secretKey);
  const key = await wrapKey(x25519.getSharedSecret(secretKey, epk), epk, rpk);
  try { return new Uint8Array(await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(s.iv) as BufferSource }, key, fromB64(s.ct) as BufferSource)); }
  catch { throw new Error("this data was not sealed for your key, or it was changed"); }
}
export const encryptJsonTo = (pub: Uint8Array, v: unknown) => encryptTo(pub, te.encode(JSON.stringify(v)));
export const decryptJsonFrom = async <T>(sk: Uint8Array, s: Sealed): Promise<T> => JSON.parse(td.decode(await decryptFrom(sk, s)));

export interface Recipient { id: string; publicKey: Uint8Array }
export interface Envelope { version: 1; iv: string; ciphertext: string; wraps: { id: string; epk: string; iv: string; ct: string }[] }
/** One AES-GCM body, plus its content key wrapped separately for every recipient. */
export async function sealForMany(plaintext: Uint8Array, recipients: Recipient[]): Promise<Envelope> {
  if (!recipients.length) throw new Error("name at least one recipient");
  if (new Set(recipients.map((r) => r.id)).size !== recipients.length) throw new Error("a recipient is listed twice");
  const content = rand(32), iv = rand(12);
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, await aesKey(content, ["encrypt"]), plaintext as BufferSource));
  const wraps = await Promise.all(recipients.map(async (r) => ({ id: r.id, ...(await encryptTo(r.publicKey, content)) })));
  return { version: 1, iv: toB64(iv), ciphertext: toB64(ct), wraps };
}
export async function openEnvelope(env: Envelope, id: string, secretKey: Uint8Array): Promise<Uint8Array> {
  const w = env.wraps.find((x) => x.id === id); if (!w) throw new Error(`this envelope was not sealed for ${id}`);
  const content = await decryptFrom(secretKey, w);
  try { return new Uint8Array(await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(env.iv) as BufferSource }, await aesKey(content, ["decrypt"]), fromB64(env.ciphertext) as BufferSource)); }
  catch { throw new Error("the envelope body was changed"); }
}
/** The commitment that can go into a round: sha256 over the envelope with sorted keys. */
export async function envelopeHash(env: Envelope): Promise<string> {
  const canon = JSON.stringify({ ciphertext: env.ciphertext, iv: env.iv, version: env.version, wraps: [...env.wraps].sort((a, b) => (a.id < b.id ? -1 : 1)).map((w) => ({ ct: w.ct, epk: w.epk, id: w.id, iv: w.iv })) });
  return toHex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", te.encode(canon))));
}
