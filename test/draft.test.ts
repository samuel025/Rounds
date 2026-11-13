import { describe, it, expect } from "vitest";
import { encodeDraft, decodeDraft, validateDraft, splitRaise, MAX_DRAFT_CHARS, type Draft } from "../src/engine/draft";

const base: Draft = { v: 1, pre: 21_000_000, raise: 9_000_000, pool: 10, ada: 5_000_000, bayo: 2_750_000, poolNow: 1_000_000,
  safes: [{ id: "safe1", holder: "chidi.testnet", amt: 500_000, cap: 5_000_000, disc: 0 }, { id: "safe2", holder: "dayo.testnet", amt: 250_000, cap: 10_000_000, disc: 0 }],
  allocs: [{ holder: "fund.testnet", bps: 7000 }, { holder: "lead.testnet", bps: 3000 }], confidential: false, note: "v3 after call with lead" };

describe("draft links", () => {
  it("round-trips and is the same text every time", async () => {
    const a = await encodeDraft(base), b = await encodeDraft({ ...base }); expect(a).toBe(b);
    expect(await decodeDraft("#" + a)).toEqual(base);
  });
  it("stays small enough for a chat message", async () => { expect((await encodeDraft(base)).length).toBeLessThan(900); });
  it("a changed term gives a different link", async () => { expect(await encodeDraft({ ...base, pool: 12 })).not.toBe(await encodeDraft(base)); });
  it("drops unknown fields instead of carrying them", () => { expect(validateDraft({ ...base, evil: "<img onerror=x>" } as any)).not.toHaveProperty("evil"); });
  it.each([
    ["a bad version", { ...base, v: 2 }], ["a negative raise", { ...base, raise: -1 }], ["a fractional pool", { ...base, pool: 1.5 }], ["a huge number", { ...base, pre: 1e15 }],
    ["a markup holder name", { ...base, safes: [{ ...base.safes[0], holder: "<script>" }] }], ["a duplicate SAFE id", { ...base, safes: [base.safes[0], base.safes[0]] }],
    ["investor shares that do not add up", { ...base, allocs: [{ holder: "a.testnet", bps: 5000 }] }], ["a duplicated investor", { ...base, allocs: [{ holder: "a.testnet", bps: 5000 }, { holder: "a.testnet", bps: 5000 }] }],
    ["a long note", { ...base, note: "x".repeat(281) }], ["a string where a number goes", { ...base, ada: "5" }], ["not an object", 5],
  ])("refuses %s", (_n, d) => { expect(() => validateDraft(d)).toThrow(); });
  it("refuses a damaged, oversized or foreign link without crashing", async () => {
    await expect(decodeDraft("#draft=!!!")).rejects.toThrow();
    await expect(decodeDraft("#other=abc")).rejects.toThrow(/not a draft/);
    await expect(decodeDraft("#draft=" + "A".repeat(MAX_DRAFT_CHARS + 1))).rejects.toThrow(/longer than allowed/);
    await expect(decodeDraft("#draft=AAAA")).rejects.toThrow();
  });
  it("a decompression bomb is cut off", async () => {
    // 5 MB of zeros deflates to a few KB: it must be refused, not inflated in memory
    const bomb = new Uint8Array(5_000_000); const cs = new CompressionStream("deflate-raw"); const w = cs.writable.getWriter(); void w.write(bomb); void w.close();
    const out: number[] = []; const r = cs.readable.getReader(); for (;;) { const { done, value } = await r.read(); if (done) break; out.push(...value); }
    const b64u = btoa(String.fromCharCode(...out)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await expect(decodeDraft("draft=" + b64u)).rejects.toThrow(/larger than allowed/);
  });
  it("confidential drafts carry the flag and nothing secret", async () => { const d = await decodeDraft(await encodeDraft({ ...base, confidential: true })); expect(d.confidential).toBe(true); expect(JSON.stringify(d)).not.toMatch(/holderCode|secret|salt/); });
});

describe("splitting the raise", () => {
  it("adds up exactly; the last investor takes the remainder", () => {
    const s = splitRaise(1_000_001n, [{ holder: "a.testnet", bps: 3333 }, { holder: "b.testnet", bps: 3333 }, { holder: "c.testnet", bps: 3334 }]);
    expect(s.reduce((a, [, x]) => a + x, 0n)).toBe(1_000_001n);
  });
});
