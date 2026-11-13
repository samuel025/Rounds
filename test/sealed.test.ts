import { describe, it, expect } from "vitest";
import { x25519 } from "@noble/curves/ed25519.js";
import { blobTag, buildClaimBlobs, openClaimBlob, sealTableForBoard, openBoardTable } from "../src/engine/sealed";
import { buildConfidentialTable, generateHolderKey, checkTableFile } from "../src/engine/zk";
import { toHex } from "../src/engine/walletkey";

const kp = () => { const secretKey = x25519.utils.randomSecretKey(); return { secretKey, publicKey: x25519.getPublicKey(secretKey) }; };
async function table() {
  const keys = await Promise.all([1, 2, 3].map(() => generateHolderKey()));
  const b = await buildConfidentialTable([
    { holderId: "ada", shareClass: "Common", shares: 600n, holderCode: keys[0].holderCode }, { holderId: "ada", shareClass: "Preferred", shares: 50n, holderCode: keys[1].holderCode },
    { holderId: "bayo", shareClass: "Common", shares: 350n, holderCode: keys[2].holderCode }], ["Common", "Preferred"]);
  return { b, keys };
}

describe("sealed claim data", () => {
  it("a holder gets every claim file of theirs back, with their key only; the tag is not an account", async () => {
    const { b, keys } = await table(); const ada = kp(), bayo = kp(), eve = kp();
    const blobs = await buildClaimBlobs(b.claimFiles, [
      { holderCode: keys[0].holderCode, encPublicKey: toHex(ada.publicKey) }, { holderCode: keys[1].holderCode, encPublicKey: toHex(ada.publicKey) }, { holderCode: keys[2].holderCode, encPublicKey: toHex(bayo.publicKey) }]);
    expect(blobs).toHaveLength(2); // ada's two classes share one blob
    const adaBlob = blobs.find((x) => x.tag === blobs[0].tag)!; expect(blobs[0].tag).toMatch(/^[0-9a-f]{64}$/);
    const tagAda = await blobTag(toHex(ada.publicKey)); const mine = blobs.find((x) => x.tag === tagAda)!;
    const got = await openClaimBlob(ada.secretKey, mine.blob); expect(got.map((c) => c.shareClass).sort()).toEqual(["Common", "Preferred"]);
    expect(got.every((c) => c.merkleRoot === String(b.root))).toBe(true);
    await expect(openClaimBlob(eve.secretKey, mine.blob)).rejects.toThrow(/not sealed for your key/);
    await expect(openClaimBlob(bayo.secretKey, mine.blob)).rejects.toThrow();
    expect(adaBlob.blob).not.toMatch(/ada|bayo|Common|shares/); // ciphertext: nothing readable in it
  });
  it("a claim file whose holder gave no key is left out, never sealed to a guess", async () => {
    const { b, keys } = await table(); const k = kp();
    const blobs = await buildClaimBlobs(b.claimFiles, [{ holderCode: keys[2].holderCode, encPublicKey: toHex(k.publicKey) }]);
    expect(blobs).toHaveLength(1); expect((await openClaimBlob(k.secretKey, blobs[0].blob)).map((c) => c.holderId)).toEqual(["bayo"]);
  });
  it("garbage and a different format are refused with a plain message", async () => {
    const k = kp(); await expect(openClaimBlob(k.secretKey, "nope")).rejects.toThrow(/not readable/);
  });
});

describe("the private table sealed for the board", () => {
  it("each member opens it with their own key and the opened table passes the Board check against the root", async () => {
    const { b } = await table(); const m = [kp(), kp()]; const out = kp();
    const s = await sealTableForBoard(b.tableFile, m.map((k, i) => ({ id: `m${i}.testnet`, publicKey: k.publicKey })));
    for (let i = 0; i < 2; i++) {
      const t = await openBoardTable(s.text, `m${i}.testnet`, m[i].secretKey, s.hash);
      const res = await checkTableFile(t, { merkleRoot: String(b.root), totalShares: String(b.totalShares) }); expect(res.ok).toBe(true);
    }
    await expect(openBoardTable(s.text, "m0.testnet", out.secretKey, s.hash)).rejects.toThrow();
    await expect(openBoardTable(s.text, "outsider.testnet", out.secretKey, s.hash)).rejects.toThrow(/not sealed for/);
  });
  it("an envelope that is not the committed one is refused before anything is decrypted", async () => {
    const { b } = await table(); const m = kp();
    const s1 = await sealTableForBoard(b.tableFile, [{ id: "m.testnet", publicKey: m.publicKey }]);
    const s2 = await sealTableForBoard(b.tableFile, [{ id: "m.testnet", publicKey: m.publicKey }]); // same table, a different envelope
    await expect(openBoardTable(s2.text, "m.testnet", m.secretKey, s1.hash)).rejects.toThrow(/NOT the one the round committed/);
    await expect(openBoardTable("{bad", "m.testnet", m.secretKey, null)).rejects.toThrow(/not readable/);
  });
  it("a table changed by the proposer after sealing is caught by the root check", async () => {
    const { b } = await table(); const m = kp();
    const forged = { ...b.tableFile, entries: b.tableFile.entries.map((e, i) => (i === 0 ? { ...e, shares: "601" } : e)) };
    const s = await sealTableForBoard(forged, [{ id: "m.testnet", publicKey: m.publicKey }]);
    const t = await openBoardTable(s.text, "m.testnet", m.secretKey, s.hash);
    expect((await checkTableFile(t, { merkleRoot: String(b.root), totalShares: String(b.totalShares) })).ok).toBe(false);
  });
});
