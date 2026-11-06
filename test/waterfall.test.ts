import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { waterfall, vested, terminate, exerciseCost, priceRound, type Waterfall } from "../src/engine/index";

const sum = (o: Record<string, bigint>) => Object.values(o).reduce((a, b) => a + b, 0n);
const D = (n: bigint) => n * 1_000_000n;
const gv1: Omit<Waterfall, "proceedsMicro"> = {
  classes: { safe1: { shares: 1_000_000n, preferenceMicro: D(500_000n) }, safe2: { shares: 250_000n, preferenceMicro: D(250_000n) }, fund: { shares: 4_500_000n, preferenceMicro: D(9_000_000n) } },
  commonShares: { ada: 5_000_000n, bayo: 2_750_000n },
};
const cents = (m: bigint) => { const c = (m + 5_000n) / 10_000n; return `${c / 100n}.${(c % 100n).toString().padStart(2, "0")}`; };

describe("GV-4 options in and out of the money (hand-checked)", () => {
  const efe = { efe: { shares: 100_000n, strikeMicro: 2_000_000n } };
  it("out of the money at $20M (pps 1.2222 < $2.00): unchanged from GV-2", () => {
    const r = waterfall({ ...gv1, options: efe, proceedsMicro: D(20_000_000n) });
    expect(r.exercised).toEqual([]);
    expect(cents(r.payoutsMicro.ada)).toBe("6111111.11");
    expect(r.payoutsMicro.efe ?? 0n).toBe(0n);
  });
  it("in the money at $60M: pps = (60M + 200k)/13.6M", () => {
    // Ada 5M x 60.2M/13.6M = 22,132,352.94; Efe 100k x 4.4264706 - 200k = 242,647.06
    const r = waterfall({ ...gv1, options: efe, proceedsMicro: D(60_000_000n) });
    expect(r.exercised).toEqual(["efe"]);
    expect(cents(r.payoutsMicro.ada)).toBe("22132352.94");
    expect(cents(r.payoutsMicro.efe)).toBe("242647.06");
  });
  it("insufficient proceeds pay preferences by rank: senior first", () => {
    const r = waterfall({ classes: { a: { shares: 1n, preferenceMicro: 100n, rank: 0 }, b: { shares: 1n, preferenceMicro: 100n, rank: 1 } }, commonShares: { c: 10n }, proceedsMicro: 150n });
    expect(r.payoutsMicro).toEqual({ c: 0n, a: 100n, b: 50n });
  });
});

describe("vesting (R7)", () => {
  const t = { totalShares: 48_000n, termMonths: 48, cliffMonths: 12 };
  it("0 before cliff, 25% at cliff, linear after, all at term", () => {
    expect(vested(t, 11)).toBe(0n); expect(vested(t, 12)).toBe(12_000n); expect(vested(t, 24)).toBe(24_000n); expect(vested(t, 48)).toBe(48_000n); expect(vested(t, 99)).toBe(48_000n);
  });
  it("termination returns unvested to the pool; exercise cost = strike x shares", () => {
    expect(terminate(t, 18)).toEqual({ vested: 18_000n, returnedToPool: 30_000n });
    expect(exerciseCost(2_000_000n, 12_000n)).toBe(24_000_000_000n);
  });
});

const wfArb = fc.record({
  common: fc.array(fc.integer({ min: 1, max: 5_000_000 }), { minLength: 1, maxLength: 3 }),
  prefs: fc.array(fc.record({ sh: fc.integer({ min: 1, max: 3_000_000 }), px: fc.integer({ min: 100_000, max: 5_000_000 }), rank: fc.integer({ min: 0, max: 1 }) }), { minLength: 0, maxLength: 4 }),
  opts: fc.array(fc.record({ sh: fc.integer({ min: 1, max: 500_000 }), strike: fc.integer({ min: 100_000, max: 6_000_000 }) }), { maxLength: 2 }),
});
const build = (r: any, e: bigint): Waterfall => ({
  commonShares: Object.fromEntries(r.common.map((s: number, i: number) => [`c${i}`, BigInt(s)])),
  classes: Object.fromEntries(r.prefs.map((p: any, i: number) => [`p${i}`, { shares: BigInt(p.sh), preferenceMicro: BigInt(p.sh) * BigInt(p.px), rank: p.rank }])),
  options: Object.fromEntries(r.opts.map((o: any, i: number) => [`o${i}`, { shares: BigInt(o.sh), strikeMicro: BigInt(o.strike) }])),
  proceedsMicro: e,
});
const E = fc.integer({ min: 0, max: 100_000_000 }).map((n) => BigInt(n) * 1_000_000n);

describe("properties P6-P9", () => {
  it("P6 payouts plus reported remainder equal proceeds; remainder is tiny", () => fc.assert(fc.property(wfArb, E, (r, e) => {
    const res = waterfall(build(r, e));
    expect(sum(res.payoutsMicro) + res.remainderMicro).toBe(e);
    const holders = BigInt(Object.keys(res.payoutsMicro).length);
    expect(res.remainderMicro >= 0n && res.remainderMicro <= holders + 1n).toBe(true);
  }), { numRuns: 500 }));

  it("P7 every holder's payout is non-decreasing in proceeds", () => fc.assert(fc.property(wfArb, E, E, (r, e1, e2) => {
    const [lo, hi] = e1 <= e2 ? [e1, e2] : [e2, e1];
    const a = waterfall(build(r, lo)).payoutsMicro, b = waterfall(build(r, hi)).payoutsMicro;
    for (const id of Object.keys(b)) expect((b[id] ?? 0n) >= (a[id] ?? 0n)).toBe(true);
  }), { numRuns: 500 }));

  it("P8 vested never decreases with time and never exceeds the grant", () => fc.assert(fc.property(
    fc.integer({ min: 1, max: 10_000_000 }), fc.integer({ min: 1, max: 60 }), fc.integer({ min: 0, max: 60 }),
    (total, term, cliffRaw) => {
      const t = { totalShares: BigInt(total), termMonths: term, cliffMonths: Math.min(cliffRaw, term) };
      let prev = 0n;
      for (let m = 0; m <= term + 3; m++) { const v = vested(t, m); expect(v >= prev && v <= t.totalShares).toBe(true); prev = v; }
    }), { numRuns: 300 }));

  it("P9 rounding never creates shares or spends more than was invested", () => fc.assert(fc.property(
    fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 20 }), fc.integer({ min: 0, max: 20 }),
    (preM, raiseM, tPct) => {
      fc.pre(preM * 1_000_000 > (preM + raiseM) * 1_000_000 * tPct / 100 + 1); // target pool must fit inside pre-money
      const r = priceRound({ common: { ada: 5_000_000n, bayo: 2_750_000n }, unissuedPool: 1_000_000n, safes: [], preMoney: D(BigInt(preM) * 1_000_000n), investors: { fund: D(BigInt(raiseM) * 1_000_000n) }, poolTarget: { num: BigInt(tPct), den: 100n } });
      expect(r.holdings.fund * r.priceMicro <= D(BigInt(raiseM) * 1_000_000n)).toBe(true);
    }), { numRuns: 300 }));
});
