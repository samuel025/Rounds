import { Rat, rat, add, mul, div, floor, cmp, sub } from "./rat";

export interface PrefClass { shares: bigint; preferenceMicro: bigint; /** lower = more senior; default 0 (pari passu) */ rank?: number }
export interface OptionLot { shares: bigint; strikeMicro: bigint }
export interface Waterfall {
  classes: Record<string, PrefClass>;
  commonShares: Record<string, bigint>;
  options?: Record<string, OptionLot>;
  proceedsMicro: bigint;
}
export interface WaterfallResult {
  converts: string[];
  exercised: string[];
  /** net payout per holder/class/option id in micro-dollars (options: gross minus strike) */
  payoutsMicro: Record<string, bigint>;
  remainderMicro: bigint;
  /** per-share payout to common as a rational (micro-dollars per share) */
  perShare: Rat;
}

const sumV = (o: Record<string, bigint>) => Object.values(o).reduce((a, b) => a + b, 0n);

/** R8. Exact; non-participating preferred; options exercise when per-share payout > strike. */
export function waterfall(w: Waterfall): WaterfallResult {
  const E = w.proceedsMicro;
  if (E < 0n) throw new Error("proceeds must be non-negative");
  for (const [id, c] of Object.entries(w.classes)) {
    if (c.shares <= 0n) throw new Error(`class ${id} must have shares`);
    if (c.preferenceMicro < 0n) throw new Error(`class ${id} preference must be non-negative`);
  }
  for (const [id, o] of Object.entries(w.options ?? {})) {
    if (o.shares <= 0n) throw new Error(`option ${id} must have shares`);
    if (o.strikeMicro < 0n) throw new Error(`option ${id} strike must be non-negative`);
  }
  for (const [h, s] of Object.entries(w.commonShares)) if (s < 0n) throw new Error(`common shares for ${h} must be non-negative`);
  const ids = Object.keys(w.classes);
  const prefPS = (id: string) => rat(w.classes[id].preferenceMicro, w.classes[id].shares);
  // lowest preference per as-converted share first; ties broken by id for determinism
  const sorted = [...ids].sort((a, b) => cmp(prefPS(a), prefPS(b)) || (a < b ? -1 : 1));
  const opts = Object.entries(w.options ?? {}).sort(([ia, a], [ib, b]) => (a.strikeMicro < b.strikeMicro ? -1 : a.strikeMicro > b.strikeMicro ? 1 : ia < ib ? -1 : 1));
  const commonTotal = sumV(w.commonShares);

  const attempt = (k: number) => {
    const converting = new Set(sorted.slice(0, k));
    const holders = sorted.slice(k);
    // pay non-converters their preferences, by rank, pro rata within a rank
    const pref: Record<string, bigint> = {};
    let avail = E;
    let short = false;
    const ranks = [...new Set(holders.map((h) => w.classes[h].rank ?? 0))].sort((a, b) => a - b);
    for (const r of ranks) {
      const g = holders.filter((h) => (w.classes[h].rank ?? 0) === r);
      const need = g.reduce((a, h) => a + w.classes[h].preferenceMicro, 0n);
      if (avail >= need) { for (const h of g) pref[h] = w.classes[h].preferenceMicro; avail -= need; }
      else { for (const h of g) pref[h] = (w.classes[h].preferenceMicro * avail) / need; avail = 0n; short = true; break; }
    }
    for (const h of holders) pref[h] ??= 0n;
    // if preferences were cut short, nothing is left for common; rounding dust is reported as remainder, never given to common
    const rem = short ? 0n : E - Object.values(pref).reduce((a, b) => a + b, 0n);
    const baseShares = commonTotal + [...converting].reduce((a, id) => a + w.classes[id].shares, 0n);
    // options: take the largest prefix (lowest strikes) that is in the money
    let j = 0, pps = baseShares === 0n ? rat(0n) : div(rat(rem), rat(baseShares));
    for (let m = 1; m <= opts.length; m++) {
      const strikes = opts.slice(0, m).reduce((a, [, o]) => a + o.strikeMicro * o.shares, 0n);
      const sh = baseShares + opts.slice(0, m).reduce((a, [, o]) => a + o.shares, 0n);
      const cand = div(rat(rem + strikes), rat(sh));
      if (cmp(cand, rat(opts[m - 1][1].strikeMicro)) > 0) { j = m; pps = cand; } else break;
    }
    return { converting, holders, pref, pps, exercised: opts.slice(0, j) };
  };

  // choose the consistent k (largest wins ties; ties pay identically)
  let chosen = attempt(0);
  let found = false;
  for (let k = 0; k <= sorted.length; k++) {
    const a = attempt(k);
    const convOk = sorted.slice(0, k).every((id) => cmp(a.pps, prefPS(id)) >= 0);
    const stayOk = k === sorted.length || cmp(attempt(k + 1).pps, prefPS(sorted[k])) <= 0;
    if (convOk && stayOk) { chosen = a; found = true; }
  }
  if (!found) throw new Error("no consistent preferred conversion set for these proceeds");

  const payouts: Record<string, bigint> = {};
  for (const [h, sh] of Object.entries(w.commonShares)) payouts[h] = floor(mul(rat(sh), chosen.pps));
  for (const id of chosen.converting) payouts[id] = floor(mul(rat(w.classes[id].shares), chosen.pps));
  for (const id of chosen.holders) payouts[id] = chosen.pref[id];
  for (const [id, o] of chosen.exercised) payouts[id] = floor(mul(rat(o.shares), chosen.pps)) - o.strikeMicro * o.shares;
  const paid = sumV(payouts);
  void add; void sub;
  return {
    converts: sorted.filter((id) => chosen.converting.has(id)),
    exercised: chosen.exercised.map(([id]) => id),
    payoutsMicro: payouts, remainderMicro: E - paid, perShare: chosen.pps,
  };
}
