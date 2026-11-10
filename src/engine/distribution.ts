/** Holder id under which a round credits the unissued option pool. It is not an account and is never paid. */
export const POOL_HOLDER = "unissued_pool";

export interface Distribution {
  /** [holder, micro-dollars], sorted by holder id, zero payouts left out */
  payouts: [string, bigint][];
  paidMicro: bigint;
  /** the part of the pot that does not divide evenly; it is not paid out and stays with the payer */
  remainderMicro: bigint;
  eligibleShares: bigint;
}

/** Sum shares per holder over every class from a "holder|class" -> shares map (the shape of the contract's cap table), leaving out the unissued pool. */
export function holderTotals(holdings: Record<string, bigint>): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  for (const [k, s] of Object.entries(holdings)) {
    const holder = k.includes("|") ? k.slice(0, k.indexOf("|")) : k;
    if (holder === POOL_HOLDER) continue;
    if (s < 0n) throw new Error(`shares of ${k} must be non-negative`);
    out[holder] = (out[holder] ?? 0n) + s;
  }
  return out;
}

/** R10. A pot shared pro rata by shares held, whatever the class. Each holder gets floor(pot * shares / eligible shares)
 *  micro-dollars, so the amounts never add up to more than the pot and the rounding remainder is reported, not paid. */
export function proRataDistribution(shares: Record<string, bigint>, potMicro: bigint): Distribution {
  if (potMicro < 0n) throw new Error("pot must be non-negative");
  let eligible = 0n;
  for (const [h, s] of Object.entries(shares)) { if (s < 0n) throw new Error(`shares of ${h} must be non-negative`); eligible += s; }
  if (eligible === 0n) throw new Error("nobody holds shares");
  const payouts: [string, bigint][] = Object.keys(shares).sort().map((h) => [h, (potMicro * shares[h]) / eligible] as [string, bigint]).filter(([, a]) => a > 0n);
  const paidMicro = payouts.reduce((a, [, x]) => a + x, 0n);
  return { payouts, paidMicro, remainderMicro: potMicro - paidMicro, eligibleShares: eligible };
}

/** The plan the Rounds contract pays out: the same `payouts` shape as an exit plan, amounts as strings. */
export function distributionPlan(d: Distribution) {
  return { payouts: d.payouts.map(([h, a]) => [h, a.toString()]) };
}
