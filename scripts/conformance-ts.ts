// Runs the TypeScript engine on the shared scenarios and writes normalized results (decimal strings).
import { readFileSync, writeFileSync } from "node:fs";
import { priceRound, waterfall, vested } from "../src/engine/index";

const [inFile, outFile] = process.argv.slice(2);
const B = (x: string | number) => BigInt(x);
const S = (o: Record<string, bigint>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.toString()]));
const run = (s: any) => {
  try {
    if (s.kind === "round") {
      const r = priceRound({ common: Object.fromEntries(Object.entries(s.common).map(([k, v]) => [k, B(v as string)])), unissuedPool: B(s.pool),
        safes: s.safes.map((x: any) => ({ id: x.id, holder: x.holder, amount: B(x.amount), postMoneyCap: B(x.cap), discountBps: x.discount_bps })),
        preMoney: B(s.pre_money), investors: Object.fromEntries(Object.entries(s.investors).map(([k, v]) => [k, B(v as string)])), poolTarget: { num: B(s.pool_target[0]), den: B(s.pool_target[1]) } });
      return { price: r.priceMicro.toString(), x_shares: r.xShares.toString(), pool_top_up: r.poolTopUp.toString(), fd: r.fullyDiluted.toString(), holdings: S(r.holdings), safe_price: S(r.safeConversionPriceMicro), regime: r.safeRegime };
    }
    if (s.kind === "waterfall") {
      const w = waterfall({ classes: Object.fromEntries(Object.entries(s.classes).map(([k, v]: any) => [k, { shares: B(v.shares), preferenceMicro: B(v.pref), rank: v.rank }])),
        commonShares: Object.fromEntries(Object.entries(s.common).map(([k, v]) => [k, B(v as string)])),
        options: Object.fromEntries(Object.entries(s.options).map(([k, v]: any) => [k, { shares: B(v.shares), strikeMicro: B(v.strike) }])), proceedsMicro: B(s.proceeds) });
      return { converts: [...w.converts].sort(), exercised: [...w.exercised].sort(), payouts: S(w.payoutsMicro), remainder: w.remainderMicro.toString() };
    }
    return { vested: vested({ totalShares: B(s.total), termMonths: s.term, cliffMonths: s.cliff }, s.months).toString() };
  } catch { return { error: true }; }
};
writeFileSync(outFile, JSON.stringify(JSON.parse(readFileSync(inFile, "utf8")).map(run)));
