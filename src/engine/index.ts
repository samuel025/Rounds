export type Rat = { num: bigint; den: bigint };
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
}
export function priceRound(_i: PricedRoundInput): PricedRoundResult { throw new Error("unimplemented: priceRound (M1)"); }

export interface Waterfall { classes: Record<string, { shares: bigint; preferenceMicro: bigint }>; commonShares: Record<string, bigint>; proceedsMicro: bigint }
export interface WaterfallResult { converts: string[]; payoutsMicro: Record<string, bigint>; remainderMicro: bigint }
export function waterfall(_w: Waterfall): WaterfallResult { throw new Error("unimplemented: waterfall (M2)"); }
