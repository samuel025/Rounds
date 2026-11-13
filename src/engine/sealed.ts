// What the proposer seals for other people after building a confidential round:
//  - each holder's claim files, sealed to that holder's own encryption key and posted on chain under an anonymous tag (sha256 of the public key,
//    never an account name), so a holder gets their claim back by connecting the wallet that derived the key: no file to keep;
//  - the whole private table, sealed once for the board's council members (an envelope with one wrapped key per member).
// Nothing here is secret-bearing: claim files hold no secret (RULES.md R12), and an envelope is ciphertext.
import { encryptJsonTo, decryptJsonFrom, sealForMany, openEnvelope, envelopeHash, type Sealed, type Envelope, type Recipient } from "./envelope";
import { fromHex, toHex } from "./walletkey";
import type { ClaimFile, TableFile } from "./zk";

/** The address of a holder's blob: sha256 of the hex public key's text. It reveals nothing about the account that derived the key. */
export async function blobTag(encPublicKeyHex: string): Promise<string> {
  return toHex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(encPublicKeyHex.toLowerCase()))));
}
export interface HolderEnc { holderCode: string; encPublicKey: string }

/** One blob per distinct public key, holding every claim file of that holder (one per class). Claim files whose holder gave no key are left out. */
export async function buildClaimBlobs(claims: ClaimFile[], keys: HolderEnc[]): Promise<{ tag: string; blob: string }[]> {
  const keyOf = new Map(keys.map((k) => [k.holderCode, k.encPublicKey.toLowerCase()]));
  const by = new Map<string, ClaimFile[]>();
  for (const c of claims) { const k = keyOf.get(c.holderCode); if (!k) continue; (by.get(k) ?? by.set(k, []).get(k)!).push(c); }
  const out: { tag: string; blob: string }[] = [];
  for (const [k, list] of by) out.push({ tag: await blobTag(k), blob: JSON.stringify(await encryptJsonTo(fromHex(k), { version: 1, claims: list })) });
  return out;
}
/** Opens a blob with the holder's own encryption key. A blob that is not theirs, or was changed, throws. */
export async function openClaimBlob(secretKey: Uint8Array, blob: string): Promise<ClaimFile[]> {
  let sealed: Sealed; try { sealed = JSON.parse(blob); } catch { throw new Error("the stored claim data is not readable"); }
  const x = await decryptJsonFrom<{ version: number; claims: ClaimFile[] }>(secretKey, sealed);
  if (x?.version !== 1 || !Array.isArray(x.claims)) throw new Error("the stored claim data has an unknown format");
  return x.claims;
}

/** Seals the private table for the board's members. Returns the envelope, its text (what goes on chain) and its hash (what goes inside the round's plan). */
export async function sealTableForBoard(table: TableFile, members: Recipient[]) {
  const envelope = await sealForMany(new TextEncoder().encode(JSON.stringify(table)), members);
  return { envelope, text: JSON.stringify(envelope), hash: await envelopeHash(envelope) };
}
/** A council member opens the table with their own key. `expectedHash` is the escrow_hash the round committed: a different envelope is refused before decrypting. */
export async function openBoardTable(text: string, memberId: string, secretKey: Uint8Array, expectedHash: string | null): Promise<TableFile> {
  let env: Envelope; try { env = JSON.parse(text); } catch { throw new Error("the stored board copy is not readable"); }
  if (!env || env.version !== 1 || !Array.isArray(env.wraps)) throw new Error("the stored board copy has an unknown format");
  if (expectedHash !== null && (await envelopeHash(env)) !== expectedHash) throw new Error("this board copy is NOT the one the round committed to (its hash differs)");
  return JSON.parse(new TextDecoder().decode(await openEnvelope(env, memberId, secretKey)));
}
