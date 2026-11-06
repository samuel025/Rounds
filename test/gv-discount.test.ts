import { it, expect } from "vitest";
import { priceRound } from "../src/engine/index";

// GV-3 (hand-checked): discount-only SAFE, $1M, 20% discount, $10B cap (cap never wins).
// P*X = V - t*V' = 18M with X = 7.75M + S, S = 1M/(0.8P) => P = 16.75/7.75 = 2.16129.. -> floor 4dp = $2.1612
it("GV-3 discount-only SAFE", () => {
  const r = priceRound({ common: { ada: 5000000n, bayo: 2750000n }, unissuedPool: 1000000n,
    safes: [{ id: "s", holder: "c", amount: 1_000_000_000_000n, postMoneyCap: 10_000_000_000_000_000n, discountBps: 2000 }],
    preMoney: 21_000_000_000_000n, investors: { fund: 9_000_000_000_000n }, poolTarget: { num: 1n, den: 10n } });
  expect(r.safeRegime.s).toBe("discount");
  expect(r.priceMicro).toBe(2_161_200n);
  expect(r.safeConversionPriceMicro.s).toBe(1_728_960n); // 0.8 x 2.1612
  expect(r.holdings.s).toBe(578_382n); // floor(1,000,000 / 1.72896)
  expect(r.holdings.fund).toBe(4_164_353n); // floor(9,000,000 / 2.1612)
});
