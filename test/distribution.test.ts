import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { proRataDistribution, holderTotals, distributionPlan, canonicalJson } from "../src/engine/index";

// Expected values worked out separately with Python integer arithmetic (not with this code):
// the final GV-1 demo cap table after Efe exercises 1,000 options (13,501,000 eligible shares) and a $100,000 pot.
describe("R10 shared payout", () => {
  const cap: Record<string, bigint> = {
    "ada|Common": 5_000_000n, "bayo|Common": 2_750_000n, "efe|Common": 1_000n,
    "chidi|SAFE 1 shadow preferred": 1_000_000n, "dayo|SAFE 2 shadow preferred": 250_000n, "fund|Series A Preferred": 4_500_000n,
    "unissued_pool|Common": 1_499_000n,
  };
  it("GV-8: $100,000 over the demo cap table pays each holder by shares, leaves the pool out and reports a $0.000003 remainder", () => {
    const d = proRataDistribution(holderTotals(cap), 100_000_000_000n);
    expect(d.eligibleShares).toBe(13_501_000n);
    expect(Object.fromEntries(d.payouts)).toEqual({ ada: 37_034_293_756n, bayo: 20_368_861_565n, chidi: 7_406_858_751n, dayo: 1_851_714_687n, efe: 7_406_858n, fund: 33_330_864_380n });
    expect(d.paidMicro).toBe(99_999_999_997n); expect(d.remainderMicro).toBe(3n);
  });
  it("a holder with several classes is paid once, on the total; plans list holders in id order with string amounts", () => {
    const t = holderTotals({ "a|Common": 1n, "a|Preferred": 2n, "b|Common": 1n, "unissued_pool|Common": 99n });
    expect(t).toEqual({ a: 3n, b: 1n });
    expect(canonicalJson(distributionPlan(proRataDistribution(t, 400n)))).toBe('{"payouts":[["a","300"],["b","100"]]}');
  });
  it("rejects a pot nobody can receive and negative inputs", () => {
    expect(() => proRataDistribution({}, 1n)).toThrow(/nobody holds shares/);
    expect(() => proRataDistribution({ a: 1n }, -1n)).toThrow(/non-negative/);
    expect(() => proRataDistribution({ a: -1n, b: 2n }, 1n)).toThrow(/non-negative/);
  });
  it("P10 payouts plus remainder equal the pot, never exceed it, and a holder with more shares never gets less", () => fc.assert(fc.property(
    fc.dictionary(fc.stringMatching(/^[a-z]{1,6}$/), fc.bigInt({ min: 0n, max: 10n ** 12n }), { minKeys: 1, maxKeys: 12 }).filter((m) => Object.values(m).some((v) => v > 0n)),
    fc.bigInt({ min: 0n, max: 10n ** 18n }),
    (shares, pot) => {
      const d = proRataDistribution(shares, pot);
      expect(d.paidMicro + d.remainderMicro).toBe(pot);
      expect(d.remainderMicro >= 0n && d.remainderMicro < BigInt(Object.keys(shares).length)).toBe(true);
      const got = Object.fromEntries(d.payouts);
      for (const [a, sa] of Object.entries(shares)) for (const [b, sb] of Object.entries(shares)) if (sa > sb) expect((got[a] ?? 0n) >= (got[b] ?? 0n)).toBe(true);
    })));
});
