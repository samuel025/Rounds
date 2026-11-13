import { describe, it, expect } from "vitest";
import { parseSeedPhrase } from "near-seed-phrase";
import { accountFromPhrase, generateFreshAccount } from "../src/engine/stealth";

describe("fresh payout account", () => {
  it("derives exactly what near-seed-phrase (the wallets' own library) derives", () => {
    const phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const ref = parseSeedPhrase(phrase); const mine = accountFromPhrase(phrase);
    expect(mine.secretKey).toBe(ref.secretKey); expect(mine.publicKey).toBe(ref.publicKey);
  });
  it("a new account is a 12-word phrase whose implicit id is the public key in hex, and the phrase recovers it", () => {
    const a = generateFreshAccount(); expect(a.phrase.split(" ")).toHaveLength(12);
    expect(a.accountId).toMatch(/^[0-9a-f]{64}$/);
    const again = accountFromPhrase(a.phrase); expect(again.accountId).toBe(a.accountId); expect(again.secretKey).toBe(a.secretKey);
    expect(generateFreshAccount().accountId).not.toBe(a.accountId);
  });
  it("refuses a phrase with a bad checksum", () => { expect(() => accountFromPhrase("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon")).toThrow(/valid recovery phrase/); });
});
