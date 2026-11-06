import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { priceRound, waterfall } from "../src/engine/index";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../vectors/${f}`, import.meta.url), "utf8"));
const B = (s: string) => BigInt(s);
const rec = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, B(v)]));
const cents = (micro: bigint) => { const c = micro / 10_000n; return `${c / 100n}.${(c % 100n).toString().padStart(2, "0")}`; };

describe("GV-1", () => {
  const v = load("gv-1.json");
  it("prices the Series A with two converting SAFEs", () => {
    const i = v.inputs;
    const r = priceRound({
      common: rec(i.common), unissuedPool: B(i.unissued_pool),
      safes: i.safes.map((s: any) => ({ id: s.id, holder: s.holder, amount: B(s.amount), postMoneyCap: B(s.post_money_cap), discountBps: s.discount_bps })),
      preMoney: B(i.round.pre_money), investors: rec(i.round.investors),
      poolTarget: { num: B(i.round.pool_target.num), den: B(i.round.pool_target.den) },
    });
    expect(r.priceMicro).toBe(B(v.expected.price_micro));
    expect(r.xShares).toBe(B(v.expected.x_shares));
    expect(r.poolTopUp).toBe(B(v.expected.pool_top_up));
    expect(r.fullyDiluted).toBe(B(v.expected.fully_diluted));
    expect(r.holdings).toEqual(rec(v.expected.holdings));
    expect(r.safeConversionPriceMicro).toEqual(rec(v.expected.safe_conversion_price_micro));
  });
});

describe("GV-2", () => {
  const v = load("gv-2.json");
  for (const c of v.cases) {
    it(`exit at $${c.proceeds}`, () => {
      const r = waterfall({
        classes: Object.fromEntries(Object.entries(v.classes).map(([k, x]: any) => [k, { shares: B(x.shares), preferenceMicro: B(x.preference_micro) }])),
        commonShares: rec(v.common_shares), proceedsMicro: B(c.proceeds) * 1_000_000n,
      });
      expect([...r.converts].sort()).toEqual([...c.converts].sort());
      expect(Object.fromEntries(Object.entries(r.payoutsMicro).map(([k, x]) => [k, cents(x)]))).toEqual(c.payouts);
    });
  }
});
