import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { convertSaft, convertSafts, unlockedTokens, saftConversionPlan, canonicalJson, planHash } from "../src/engine/index";

const M = 1_000_000n;
const base = { id: "s1", holder: "chidi.t", amountMicro: 500_000n * M, fdvCapMicro: 20_000_000n * M, discountBps: 0 };
const supply = 1_000_000_000n;

// Worked by hand first: cap price = $20,000,000 / 1,000,000,000 = $0.02 a token, so $500,000 buys 25,000,000 tokens.
describe("R11 SAFT conversion", () => {
  it("GV-9a: a cap-only SAFT converts at the cap price", () => {
    const r = convertSaft(base, { totalSupply: supply });
    expect(r.tokens).toBe(25_000_000n); expect(r.regime).toBe("cap"); expect(r.remainderMicro).toBe(0n);
    expect(r.price).toEqual({ num: 20_000n, den: 1n });
  });
  it("GV-9b: with a 20% discount and a $0.05 launch price the cap ($0.02) is lower than the discount price ($0.04), so the cap wins", () => {
    const r = convertSaft({ ...base, discountBps: 2000 }, { totalSupply: supply, launchPriceMicro: 50_000n });
    expect(r.regime).toBe("cap"); expect(r.tokens).toBe(25_000_000n);
  });
  it("GV-9c: at a $0.015 launch price the discount price is $0.012, which beats the cap: 41,666,666 tokens and $0.008 of remainder", () => {
    const r = convertSaft({ ...base, discountBps: 2000 }, { totalSupply: supply, launchPriceMicro: 15_000n });
    expect(r.regime).toBe("discount"); expect(r.tokens).toBe(41_666_666n); expect(r.remainderMicro).toBe(8_000n);
  });
  it("a discount-only SAFT works without a cap; a SAFT with neither is refused", () => {
    expect(convertSaft({ ...base, fdvCapMicro: 0n, discountBps: 5000 }, { totalSupply: supply, launchPriceMicro: 40_000n }).tokens).toBe(25_000_000n); // $0.02 after 50% off $0.04
    expect(() => convertSaft({ ...base, fdvCapMicro: 0n }, { totalSupply: supply })).toThrow(/cap or a discount/);
  });
  it("rejects invalid inputs", () => {
    const t = { totalSupply: supply, launchPriceMicro: 1n };
    expect(() => convertSaft({ ...base, amountMicro: 0n }, t)).toThrow(/amount/);
    expect(() => convertSaft(base, { totalSupply: 0n })).toThrow(/supply/);
    expect(() => convertSaft({ ...base, discountBps: 10_000 }, t)).toThrow(/discount/);
    expect(() => convertSaft({ ...base, discountBps: 100 }, { totalSupply: supply })).toThrow(/launch price/);
    expect(() => convertSaft({ ...base, fdvCapMicro: -1n }, t)).toThrow(/cap/);
  });
  it("investors together cannot hold more tokens than exist; duplicate ids are refused", () => {
    expect(() => convertSafts([base, { ...base, id: "s2", holder: "dayo.t", amountMicro: 20_000_000n * M }], { totalSupply: supply })).toThrow(/more tokens than exist/);
    expect(() => convertSafts([base, base], { totalSupply: supply })).toThrow(/duplicate/);
    const ok = convertSafts([base, { ...base, id: "s2", holder: "dayo.t", amountMicro: 250_000n * M }], { totalSupply: supply });
    expect(ok.totalTokens).toBe(37_500_000n); expect(ok.shareOfSupply).toEqual({ num: 3n, den: 80n });
  });
  it("unlocking follows the vesting rule: nothing before the cliff, linear after", () => {
    const t = { termMonths: 24, cliffMonths: 6 };
    expect(unlockedTokens(24_000_000n, t, 5)).toBe(0n); expect(unlockedTokens(24_000_000n, t, 6)).toBe(6_000_000n); expect(unlockedTokens(24_000_000n, t, 24)).toBe(24_000_000n);
  });
  it("the board's plan carries the launch inputs and every conversion, so its hash covers both", async () => {
    const plan = saftConversionPlan([base], { totalSupply: supply });
    expect(canonicalJson(plan)).toBe('{"conversions":[{"amount_micro":"500000000000","discount_bps":0,"fdv_cap_micro":"20000000000000","holder":"chidi.t","id":"s1","price":"20000/1","regime":"cap","tokens":"25000000"}],"tge":{"launch_price_micro":"0","total_supply":"1000000000"}}');
    const other = saftConversionPlan([base], { totalSupply: supply * 2n });
    expect(await planHash(canonicalJson(plan))).not.toBe(await planHash(canonicalJson(other)));
  });
  it("P11 tokens never cost more than was paid, one more token would, and a higher cap never gives more tokens", () => fc.assert(fc.property(
    fc.bigInt({ min: 1n, max: 10n ** 15n }), fc.bigInt({ min: 1n, max: 10n ** 18n }), fc.bigInt({ min: 1n, max: 10n ** 12n }), fc.integer({ min: 0, max: 9_999 }), fc.bigInt({ min: 1n, max: 10n ** 9n }),
    (amount, cap, sup, disc, launch) => {
      const s = { id: "x", holder: "h", amountMicro: amount, fdvCapMicro: cap, discountBps: disc };
      const t = { totalSupply: sup, launchPriceMicro: launch };
      let r; try { r = convertSaft(s, t); } catch { return; } // a price that rounds to nothing is refused
      expect(r.remainderMicro >= 0n).toBe(true);
      expect((r.tokens + 1n) * r.price.num > amount * r.price.den).toBe(true);
      expect(r.tokens * r.price.num <= amount * r.price.den).toBe(true);
      const looser = convertSaft({ ...s, fdvCapMicro: cap * 2n }, t);
      expect(looser.tokens <= r.tokens).toBe(true);
    })));
});
