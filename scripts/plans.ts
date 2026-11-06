// Rebuilds, from the engine alone, every plan the demo put on chain (used by verify-onchain and replay).
import { priceRound, waterfall, canonicalJson, pricedRoundPlan } from "../src/engine/index";

const M = 1_000_000n;
export interface Accounts { ada: string; bayo: string; chidi: string; dayo: string; fund: string; efe: string; zed: string }
export const CLASSES = { common: "Common", seriesA: "Series A Preferred", safe1: "SAFE 1 shadow preferred", safe2: "SAFE 2 shadow preferred" };

export function demoPlans(A: Accounts) {
  const founders = { issuances: [{ class: CLASSES.common, holder: A.ada, shares: "5000000" }, { class: CLASSES.common, holder: A.bayo, shares: "2750000" }, { class: CLASSES.common, holder: "unissued_pool", shares: "1000000" }] };
  const spec = [{ id: "safe1", holder: A.chidi, amt: 500_000n, cap: 5_000_000n, cls: CLASSES.safe1 }, { id: "safe2", holder: A.dayo, amt: 250_000n, cap: 10_000_000n, cls: CLASSES.safe2 }];
  const safeRounds = spec.map((s) => ({ safes: [{ id: s.id, holder: s.holder, amount: (s.amt * M).toString(), post_money_cap: (s.cap * M).toString(), discount_bps: 0, converted: false }] }));
  const input = { common: { [A.ada]: 5_000_000n, [A.bayo]: 2_750_000n }, unissuedPool: 1_000_000n,
    safes: spec.map((s) => ({ id: s.id, holder: s.holder, amount: s.amt * M, postMoneyCap: s.cap * M, discountBps: 0 })),
    preMoney: 21_000_000n * M, investors: { [A.fund]: 9_000_000n * M }, poolTarget: { num: 1n, den: 10n } };
  const result = priceRound(input);
  const seriesA = pricedRoundPlan(input, result, { safeClass: (id) => spec.find((s) => s.id === id)!.cls, seriesClass: CLASSES.seriesA });
  const w = waterfall({ classes: { safe1: { shares: 1_000_000n, preferenceMicro: 500_000n * M }, safe2: { shares: 250_000n, preferenceMicro: 250_000n * M }, fund: { shares: 4_500_000n, preferenceMicro: 9_000_000n * M } },
    commonShares: { ada: 5_000_000n, bayo: 2_750_000n }, options: { efe: { shares: 100_000n, strikeMicro: result.priceMicro } }, proceedsMicro: 20_000_000n * M });
  const who: Record<string, string> = { ada: A.ada, bayo: A.bayo, safe1: A.chidi, safe2: A.dayo, fund: A.fund };
  const exit = { payouts: Object.entries(who).map(([k, acct]) => [acct, w.payoutsMicro[k].toString()]) };
  const rounds = [founders, ...safeRounds, seriesA].map((p) => canonicalJson(p));
  // holdings every closed round should have credited, keyed "holder|class"
  const holdings: Record<string, bigint> = {};
  for (const p of [founders, seriesA]) for (const i of p.issuances) holdings[`${i.holder}|${i.class}`] = (holdings[`${i.holder}|${i.class}`] ?? 0n) + BigInt(i.shares);
  return { rounds, exit: canonicalJson(exit), holdings, result, waterfall: w, who };
}
