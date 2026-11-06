import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { priceRound } from "../src/engine/index";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../vectors/${f}`, import.meta.url), "utf8"));
const B = (s: string) => BigInt(s);
const rec = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, B(v)]));

// Expected values in vectors/gv-5..7.json were derived by hand before running the engine (derivations in docs/NOTES.md).
function check(v: any) {
  const i = v.inputs;
  const r = priceRound({ common: rec(i.common), unissuedPool: B(i.unissued_pool),
    safes: i.safes.map((s: any) => ({ id: s.id, holder: s.holder, amount: B(s.amount), postMoneyCap: B(s.post_money_cap), discountBps: s.discount_bps })),
    preMoney: B(i.round.pre_money), investors: rec(i.round.investors), poolTarget: { num: B(i.round.pool_target.num), den: B(i.round.pool_target.den) } });
  expect(r.priceMicro).toBe(B(v.expected.price_micro));
  expect(r.poolTopUp).toBe(B(v.expected.pool_top_up));
  expect(r.fullyDiluted).toBe(B(v.expected.fully_diluted));
  expect(r.holdings).toEqual(rec(v.expected.holdings));
  expect(r.safeConversionPriceMicro).toEqual(rec(v.expected.safe_conversion_price_micro ?? v.expected.safe_price_micro));
  expect(r.safeRegime).toEqual(v.expected.regime);
}
describe("GV-5 cap and discount each win in turn", () => { for (const c of load("gv-5.json").cases) it(c.name, () => check(c)); });
describe("GV-6 no pool top-up", () => it("keeps the existing pool and prices at V/(X+pool)", () => check(load("gv-6.json"))));
describe("GV-7 down round below the SAFE cap", () => it("converts the SAFE at the round price", () => check(load("gv-7.json"))));
