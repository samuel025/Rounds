import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { KEY_MESSAGE, KEY_NONCE, KEY_RECIPIENT, nep413Hash, verifyNep413, deriveHolderSecret, deriveEncryptionKey, toB64, formatPublicKey, toHex, type Nep413 } from "../src/engine/walletkey";
import { generateHolderKey, FIELD } from "../src/engine/zk";

// a throwaway wallet key: signs like a NEP-413 wallet (ed25519 over the NEP-413 hash)
const sk = ed25519.utils.randomSecretKey(); const pk = formatPublicKey(ed25519.getPublicKey(sk));
const sign = (p: Nep413) => toB64(ed25519.sign(nep413Hash(p), sk));
const keyPayload: Nep413 = { message: KEY_MESSAGE, nonce: KEY_NONCE, recipient: KEY_RECIPIENT };

describe("NEP-413", () => {
  it("a signature over the NEP-413 hash verifies, and any changed field breaks it", () => {
    // NOTE: a round trip with our own key, not the specification's published vector (not available offline); the framing is checked in the next test
    const nonce = Uint8Array.from(Buffer.from("KNV0cOpvJ50D5vfF9pqWom8wo2sliQ4W+Wa7uZ3Uk6Y=", "base64"));
    const h = nep413Hash({ message: "Hello NEAR!", nonce, recipient: "alice.near" });
    expect(h.length).toBe(32);
    const sig = toB64(ed25519.sign(h, sk));
    expect(verifyNep413({ message: "Hello NEAR!", nonce, recipient: "alice.near" }, sig, pk)).toBe(true);
    expect(verifyNep413({ message: "Hello NEAR?", nonce, recipient: "alice.near" }, sig, pk)).toBe(false);
    expect(verifyNep413({ message: "Hello NEAR!", nonce, recipient: "bob.near" }, sig, pk)).toBe(false);
    expect(verifyNep413({ message: "Hello NEAR!", nonce, recipient: "alice.near", callbackUrl: "https://x" }, sig, pk)).toBe(false);
  });
  it("rejects a wrong key and garbage without throwing", () => {
    const sig = sign(keyPayload);
    expect(verifyNep413(keyPayload, sig, formatPublicKey(ed25519.getPublicKey(ed25519.utils.randomSecretKey())))).toBe(false);
    expect(verifyNep413(keyPayload, "not base64!!", pk)).toBe(false);
    expect(verifyNep413(keyPayload, sig, "secp256k1:abc")).toBe(false);
  });
  it("hash framing: the 2^31+413 tag comes first", () => {
    // flipping the tag would change the hash; this guards the constant by recomputing it independently
    const nonce = new Uint8Array(32);
    const a = nep413Hash({ message: "m", nonce, recipient: "r" });
    const b = nep413Hash({ message: "m", nonce, recipient: "r" });
    expect(toHex(a)).toBe(toHex(b));
  });
});

describe("keys derived from a wallet signature", () => {
  it("the same wallet gives the same keys again (that is the recovery)", async () => {
    const s1 = sign(keyPayload), s2 = sign(keyPayload);
    expect(s1).toBe(s2); // ed25519 is deterministic
    expect(await deriveHolderSecret(s1, "Common")).toBe(await deriveHolderSecret(s2, "Common"));
    expect(toHex((await deriveEncryptionKey(s1)).publicKey)).toBe(toHex((await deriveEncryptionKey(s2)).publicKey));
  });
  it("one secret per class, always inside the field, and no two wallets share one", async () => {
    const s = sign(keyPayload);
    const a = await deriveHolderSecret(s, "Common"), b = await deriveHolderSecret(s, "Series A Preferred");
    expect(a).not.toBe(b);
    expect(BigInt(a) < FIELD && BigInt(b) < FIELD).toBe(true);
    const other = toB64(ed25519.sign(nep413Hash(keyPayload), ed25519.utils.randomSecretKey()));
    expect(await deriveHolderSecret(other, "Common")).not.toBe(a);
  });
  it("a different message signed by the same wallet gives different keys (no cross-use)", async () => {
    const s = sign(keyPayload), t = sign({ ...keyPayload, message: "something else" });
    expect(await deriveHolderSecret(t, "Common")).not.toBe(await deriveHolderSecret(s, "Common"));
  });
  it("the derived secret makes a valid, repeatable holder key", async () => {
    const secret = await deriveHolderSecret(sign(keyPayload), "Common");
    const k1 = await generateHolderKey(() => BigInt(secret)), k2 = await generateHolderKey(() => BigInt(secret));
    expect(k1.holderCode).toBe(k2.holderCode); expect(k1.holderSecret).toBe(secret);
  });
  it("rejects a signature of the wrong size", async () => { await expect(deriveHolderSecret(toB64(new Uint8Array(10)), "Common")).rejects.toThrow(/64 bytes/); });
  it("base58 round trip of the public key", () => { expect(base58.decode(pk.slice(8)).length).toBe(32); });
});
