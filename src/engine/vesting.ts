export interface VestingTerms { totalShares: bigint; termMonths: number; cliffMonths: number }
export const DEFAULT_TERMS = { termMonths: 48, cliffMonths: 12 } as const;

/** R7: nothing before the cliff; at the cliff cliff/term of the grant; then linear monthly; all at term. Rounds down. */
export function vested(t: VestingTerms, monthsElapsed: number): bigint {
  if (!Number.isInteger(monthsElapsed) || monthsElapsed < 0) throw new Error("monthsElapsed must be a non-negative integer");
  if (monthsElapsed < t.cliffMonths) return 0n;
  if (monthsElapsed >= t.termMonths) return t.totalShares;
  return (t.totalShares * BigInt(monthsElapsed)) / BigInt(t.termMonths);
}

/** Exercise cost = strike x shares (micro-dollars). */
export const exerciseCost = (strikeMicro: bigint, shares: bigint) => strikeMicro * shares;

/** Termination: unvested shares return to the pool; vested options stay exercisable for the window. */
export function terminate(t: VestingTerms, monthsAtTermination: number) {
  const v = vested(t, monthsAtTermination);
  return { vested: v, returnedToPool: t.totalShares - v };
}
