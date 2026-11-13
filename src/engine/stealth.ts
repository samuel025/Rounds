// A fresh payout account made in the browser: a new ed25519 key, its implicit NEAR account id (the hex of the public key, which exists as soon as
// anything is sent to it) and a 12-word recovery phrase using the standard NEAR derivation path m/44'/397'/0' (SLIP-10 ed25519), so the phrase imports
// into any NEAR wallet. Nothing here touches a network or a wallet. The honest limit: a fresh address hides the claim from the holder's main wallet,
// but paying from it to an account linked to you (an exchange, your main wallet) links them again.
import { ed25519 } from "@noble/curves/ed25519.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { base58 } from "@scure/base";
import { toHex } from "./walletkey";

export const NEAR_PATH = [44, 397, 0] as const;

/** SLIP-10 for ed25519: every step is hardened. */
export function slip10(seed: Uint8Array, path: readonly number[]): Uint8Array {
  let I = hmac(sha512, new TextEncoder().encode("ed25519 seed"), seed);
  for (const idx of path) {
    const data = new Uint8Array(37); data.set(I.slice(0, 32), 1);
    new DataView(data.buffer).setUint32(33, (idx | 0x80000000) >>> 0, false);
    I = hmac(sha512, I.slice(32), data);
  }
  return I.slice(0, 32);
}
export interface FreshAccount { phrase: string; accountId: string; publicKey: string; secretKey: string }
export function accountFromPhrase(phrase: string): FreshAccount {
  const p = phrase.trim().toLowerCase().split(/\s+/).join(" ");
  if (!validateMnemonic(p, wordlist)) throw new Error("that is not a valid recovery phrase");
  const seed = slip10(mnemonicToSeedSync(p), NEAR_PATH); const pub = ed25519.getPublicKey(seed);
  // NEAR's secret key format is base58(seed ++ public key)
  const sk = new Uint8Array(64); sk.set(seed); sk.set(pub, 32);
  return { phrase: p, accountId: toHex(pub), publicKey: `ed25519:${base58.encode(pub)}`, secretKey: `ed25519:${base58.encode(sk)}` };
}
/** Makes a brand-new account. Randomness comes from the browser's crypto.getRandomValues. */
export const generateFreshAccount = (): FreshAccount => accountFromPhrase(generateMnemonic(wordlist, 128));
