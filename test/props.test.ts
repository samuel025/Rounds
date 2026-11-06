import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { priceRound, capOnlyCapitalization, type Safe, type PricedRoundInput } from "../src/engine/index";

const sum = (o: Record<string, bigint>) => Object.values(o).reduce((a, b) => a + b, 0n);
const safeArb = (i: number, disc: boolean) => fc.record({
  amt: fc.integer({ min: 10_000, max: 1_000_000 }),
  capM: fc.integer({ min: 3_000_000, max: 30_000_000 }),
  d: disc ? fc.constantFrom(0, 1000, 2000, 3000) : fc.constant(0),
}).map((r): Safe => ({ id: `s${i}`, holder: `h${i}`, amount: BigInt(r.amt) * 1_000_000n, postMoneyCap: BigInt(r.capM) * 1_000_000n, discountBps: r.d }));
const inputArb = (disc: boolean) => fc.record({
  a: fc.integer({ min: 1_000_000, max: 9_000_000 }),
  b: fc.integer({ min: 100_000, max: 5_000_000 }),
  pool: fc.integer({ min: 0, max: 2_000_000 }),
  safes: fc.integer({ min: 0, max: 3 }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => safeArb(i, disc)))),
  pre: fc.integer({ min: 15, max: 80 }),
  raise: fc.integer({ min: 1, max: 20 }),
  t: fc.constantFrom(0, 5, 10, 15, 20),
}).map((r): PricedRoundInput => ({
  common: { ada: BigInt(r.a), bayo: BigInt(r.b) }, unissuedPool: BigInt(r.pool), safes: r.safes as Safe[],
  preMoney: BigInt(r.pre) * 1_000_000_000_000n / 1_000_000n * 1_000_000n, investors: { fund: BigInt(r.raise) * 1_000_000_000_000n / 1_000_000n * 1_000_000n },
  poolTarget: { num: BigInt(r.t), den: 100n },
}));
const valid = (i: PricedRoundInput) => { try { capOnlyCapitalization(sum(i.common) + i.unissuedPool, i.safes); return true; } catch { return false; } };

describe("properties", () => {
  it("P1 holdings and pool sum to fully diluted", () => fc.assert(fc.property(inputArb(true).filter(valid), (i) => {
    const r = priceRound(i); expect(sum(r.holdings)).toBe(r.fullyDiluted);
  }), { numRuns: 300 }));

  it("P2 cap-only SAFE holds A/C of pre-round capitalization within one share", () => fc.assert(fc.property(inputArb(false).filter(valid), (i) => {
    const r = priceRound(i);
    if (i.safes.some((s) => r.safeRegime[s.id] !== "cap")) return; // P2 holds only when every SAFE converts at its cap
    const capital = capOnlyCapitalization(sum(i.common) + i.unissuedPool, i.safes);
    for (const s of i.safes) {
      if (r.safeRegime[s.id] !== "cap") continue; // down round: converts at round price
      const exact = (s.amount * capital.num) / (s.postMoneyCap * capital.den);
      const diff = r.holdings[s.id] - exact; expect(diff >= -1n && diff <= 1n).toBe(true);
    }
  }), { numRuns: 300 }));

  it("P3 price x fully diluted ~ post-money within rounding", () => fc.assert(fc.property(inputArb(true).filter(valid), (i) => {
    const r = priceRound(i);
    const post = i.preMoney + sum(i.investors);
    const fdv = r.priceMicro * r.fullyDiluted;
    const tol = r.priceMicro * (BigInt(i.safes.length) + 3n) + (r.fullyDiluted * 100n); // price step + per-holder floors
    expect(fdv - post <= tol && post - fdv <= tol).toBe(true);
  }), { numRuns: 300 }));

  it("P4 SAFE order does not change the result", () => fc.assert(fc.property(inputArb(true).filter(valid), (i) => {
    const a = priceRound(i);
    const b = priceRound({ ...i, safes: [...i.safes].reverse() });
    expect(b.priceMicro).toBe(a.priceMicro); expect(b.holdings).toEqual(a.holdings);
  }), { numRuns: 300 }));

  it("P5 a higher cap never gives a SAFE more shares", () => fc.assert(fc.property(inputArb(true).filter((i) => i.safes.length > 0 && valid(i)), fc.integer({ min: 1, max: 5_000_000 }), (i, bump) => {
    const hi: PricedRoundInput = { ...i, safes: i.safes.map((s, k) => k === 0 ? { ...s, postMoneyCap: s.postMoneyCap + BigInt(bump) * 1_000_000n } : s) };
    const a = priceRound(i), b = priceRound(hi);
    expect(b.holdings[i.safes[0].id] <= a.holdings[i.safes[0].id]).toBe(true);
  }), { numRuns: 300 }));
});
