import { Rat, rat, add, sub, mul, div, floor, cmp } from "./rat";
export * from "./rat";
import { waterfall as wf, type Waterfall, type WaterfallResult } from "./waterfall";
export const waterfall = wf;
export type { Waterfall, WaterfallResult };

export interface Safe { id: string; holder: string; amount: bigint; postMoneyCap: bigint; discountBps: number }
export interface PricedRoundInput {
  common: Record<string, bigint>;
  unissuedPool: bigint;
  safes: Safe[];
  preMoney: bigint;
  investors: Record<string, bigint>;
  poolTarget: Rat;
}
export interface PricedRoundResult {
  priceMicro: bigint;
  xShares: bigint;
  poolTopUp: bigint;
  fullyDiluted: bigint;
  holdings: Record<string, bigint>;
  safeConversionPriceMicro: Record<string, bigint>;
  safeRegime: Record<string, "cap" | "discount">;
  /** fully diluted shares minus V'/P, as a rational (rounding report, R6) */
  fdVsPostMoneyDiff: Rat;
  iterations: number;
}

const PRICE_STEP = 100n; // 4 decimals of a dollar, in micro-dollars
const MAX_ITER = 1000;

/** R3 closed form, cap-only. Exported for cross-checks (R4). */
export function capOnlyCapitalization(n: bigint, safes: Safe[]): Rat {
  let sp = rat(0n);
  for (const s of safes) sp = add(sp, rat(s.amount, s.postMoneyCap));
  if (cmp(sp, rat(1n)) >= 0) throw new Error("sum of SAFE post-money ratios must be below 1");
  return div(rat(n), sub(rat(1n), sp));
}

export function priceRound(inp: PricedRoundInput): PricedRoundResult {
  const issued = Object.values(inp.common).reduce((a, b) => a + b, 0n);
  const B = inp.unissuedPool;
  const N = issued + B;
  const V = inp.preMoney;
  const I = Object.values(inp.investors).reduce((a, b) => a + b, 0n);
  const Vp = V + I;
  const t = inp.poolTarget;
  const one = rat(1n);
  capOnlyCapitalization(N, inp.safes); // validates sum p < 1

  type Regime = "cap" | "discount";
  const solve = (P: bigint) => {
    // Given a round price, find regimes and Cap_pre self-consistently.
    let regimes = inp.safes.map((): Regime => "cap");
    let cap = rat(N);
    let shares: bigint[] = [];
    for (let k = 0; k < 50; k++) {
      let spCap = rat(0n), disc = rat(0n);
      inp.safes.forEach((s, i) => {
        if (regimes[i] === "cap") spCap = add(spCap, rat(s.amount, s.postMoneyCap));
        else disc = add(disc, div(rat(s.amount), mul(rat(P), sub(one, rat(BigInt(s.discountBps), 10000n)))));
      });
      cap = div(add(rat(N), disc), sub(one, spCap));
      const next = inp.safes.map((s, i): Regime => {
        const capPrice = div(rat(s.postMoneyCap), cap);
        const discPrice = mul(rat(P), sub(one, rat(BigInt(s.discountBps), 10000n)));
        return cmp(capPrice, discPrice) <= 0 ? "cap" : "discount";
      });
      shares = inp.safes.map((s, i) => regimes[i] === "cap"
        ? floor(mul(rat(s.amount, s.postMoneyCap), cap))
        : floor(div(rat(s.amount), mul(rat(P), sub(one, rat(BigInt(s.discountBps), 10000n))))));
      if (next.every((r, i) => r === regimes[i])) return { regimes, cap, shares };
      regimes = next;
    }
    throw new Error("SAFE regime did not settle");
  };

  const priceFor = (safeShares: bigint) => {
    const X = issued + safeShares;
    const target = sub(rat(V), mul(t, rat(Vp)));
    let p = div(target, rat(X));
    if (cmp(mul(t, div(rat(Vp), p)), rat(B)) < 0) p = div(rat(V), rat(X + B)); // no top-up (R6)
    return floor(div(p, rat(PRICE_STEP))) * PRICE_STEP;
  };

  let P = priceFor(0n);
  let state = solve(P);
  let iterations = 0;
  for (; iterations < MAX_ITER; iterations++) {
    const sum = state.shares.reduce((a, b) => a + b, 0n);
    const nextP = priceFor(sum);
    if (nextP === P) break;
    P = nextP;
    state = solve(P);
  }
  if (iterations >= MAX_ITER) throw new Error("priced round did not converge in 1000 iterations");

  const safeSum = state.shares.reduce((a, b) => a + b, 0n);
  const X = issued + safeSum;
  const wanted = floor(div(mul(t, rat(Vp)), rat(P)));
  const topUp = wanted > B ? wanted - B : 0n;

  const holdings: Record<string, bigint> = { ...inp.common };
  const convPrice: Record<string, bigint> = {};
  const regime: Record<string, Regime> = {};
  inp.safes.forEach((s, i) => {
    holdings[s.id] = state.shares[i];
    regime[s.id] = state.regimes[i];
    convPrice[s.id] = state.regimes[i] === "cap"
      ? floor(div(rat(s.postMoneyCap), state.cap))
      : floor(mul(rat(P), sub(one, rat(BigInt(s.discountBps), 10000n))));
  });
  let newShares = 0n;
  for (const [k, amt] of Object.entries(inp.investors)) {
    const sh = amt / P;
    holdings[k] = (holdings[k] ?? 0n) + sh;
    newShares += sh;
  }
  holdings["unissued_pool"] = B + topUp;
  const fd = Object.values(holdings).reduce((a, b) => a + b, 0n);
  return {
    priceMicro: P, xShares: X, poolTopUp: topUp, fullyDiluted: fd, holdings,
    safeConversionPriceMicro: convPrice, safeRegime: regime,
    fdVsPostMoneyDiff: sub(rat(fd), div(rat(Vp), rat(P))), iterations,
  };
}
