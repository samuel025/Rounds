// Keys from the connected wallet. One signature of a fixed message (src/engine/walletkey.ts) gives the holder's ZK secret and an encryption key;
// the same wallet signs it again in any browser, so nothing has to be kept in a file. The signature is held in memory only (it is the master secret)
// and dropped when the account changes. Wallets whose signatures are not repeatable are detected up front, because a key that could not be derived again is worse than a file.
import { account, onAccount, signMessage } from "./wallet";
import { KEY_MESSAGE, KEY_NONCE, KEY_RECIPIENT, verifyNep413, deriveHolderSecret, deriveEncryptionKey, toHex } from "../../src/engine/walletkey";

let held: { account: string; signature: string; repeatable: boolean } | null = null;
onAccount((a) => { if (held && held.account !== a) held = null; });

const once = async () => {
  const out = await signMessage(KEY_MESSAGE, KEY_RECIPIENT, KEY_NONCE);
  if (!verifyNep413({ message: KEY_MESSAGE, nonce: KEY_NONCE, recipient: KEY_RECIPIENT }, out.signature, out.publicKey)) throw new Error("the wallet's signature does not verify");
  return out.signature;
};
/** The wallet's signature of the key message. `proveRepeatable` signs twice the first time (two wallet prompts) and refuses a wallet that answers differently. */
let inflight: Promise<string> | null = null;
export function masterSignature(proveRepeatable = false): Promise<string> {
  const me = account(); if (!me) return Promise.reject(new Error("connect a wallet first"));
  if (held && held.account === me && (held.repeatable || !proveRepeatable)) return Promise.resolve(held.signature);
  // one prompt at a time: two callers asking together share one signing round instead of opening two wallet windows
  if (inflight) return inflight.then(() => masterSignature(proveRepeatable));
  inflight = (async () => {
    const a = await once(); let repeatable = false;
    if (proveRepeatable) { const b = await once(); if (a !== b) throw new Error("this wallet signs differently each time, so a key derived from it could never be recovered. Use a holder key file instead."); repeatable = true; }
    held = { account: me, signature: a, repeatable }; return a;
  })().finally(() => { inflight = null; });
  return inflight;
}
export const walletHolderSecret = async (shareClass: string, proveRepeatable = false) => deriveHolderSecret(await masterSignature(proveRepeatable), shareClass);
export async function walletEncryptionKey(proveRepeatable = false) { const k = await deriveEncryptionKey(await masterSignature(proveRepeatable)); return { ...k, publicKeyHex: toHex(k.publicKey) }; }
