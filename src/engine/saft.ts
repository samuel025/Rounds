import { Rat, rat, mul, div, floor, cmp, sub } from "./rat";
import { vested, type VestingTerms } from "./vesting";

/** A SAFT or token warrant: money paid now for the right to tokens at launch (the token generation event, TGE). Rounds models the numbers only. */
export interface Saft {
  id: string; holder: string;
  /** purchase amount, micro-dollars */ amountMicro: bigint;
  /** fully diluted valuation cap, micro-dollars; 0n for none */ fdvCapMicro: bigint;
  /** discount on the launch price, in basis points (0 for none) */ discountBps: number;
}
/** What is known at launch. Tokens are counted in base units (the smallest unit of the token, as in NEP-141): `totalSupply` is in base units,
 *  `decimals` says how many base units make one whole token, and `launchPriceMicro` is micro-dollars per WHOLE token (used for discounts). */
export interface Tge { totalSupply: bigint; launchPriceMicro?: bigint; decimals?: number }
export interface SaftResult {
  id: string; holder: string; tokens: bigint;
  regime: "cap" | "discount";
  /** conversion price, micro-dollars per base unit of the token, exact */ price: Rat;
  /** purchase money not covered by whole tokens, micro-dollars (always less than one token's price) */ remainderMicro: bigint;
}

/** R11. Tokens = floor(amount / price), where price = the lower of the cap price (FDV cap / total supply) and the discounted
 *  launch price (launch price x (1 - discount)). A warrant that follows the same cap is a SAFT with no discount. Exact; the remainder is reported. */
export function convertSaft(s: Saft, tge: Tge): SaftResult {
  if (s.amountMicro <= 0n) throw new Error("amount must be positive");
  if (tge.totalSupply <= 0n) throw new Error("total supply must be positive");
  if (s.fdvCapMicro < 0n) throw new Error("cap must be non-negative");
  if (!Number.isInteger(s.discountBps) || s.discountBps < 0 || s.discountBps >= 10_000) throw new Error("discount must be 0 to 9,999 basis points");
  if (s.discountBps > 0 && (tge.launchPriceMicro === undefined || tge.launchPriceMicro <= 0n)) throw new Error("a discount needs a positive launch price");
  const options: { regime: "cap" | "discount"; price: Rat }[] = [];
  if (s.fdvCapMicro > 0n) options.push({ regime: "cap", price: rat(s.fdvCapMicro, tge.totalSupply) });
  const unit = 10n ** BigInt(tge.decimals ?? 0);
  if (!Number.isInteger(tge.decimals ?? 0) || (tge.decimals ?? 0) < 0 || (tge.decimals ?? 0) > 24) throw new Error("decimals must be 0 to 24");
  if (s.discountBps > 0) options.push({ regime: "discount", price: rat(tge.launchPriceMicro! * BigInt(10_000 - s.discountBps), 10_000n * unit) });
  if (!options.length) throw new Error("a SAFT needs a cap or a discount");
  const best = options.reduce((a, b) => (cmp(b.price, a.price) < 0 ? b : a)); // cap wins a tie
  if (best.price.num <= 0n) throw new Error("conversion price must be positive");
  const tokens = floor(div(rat(s.amountMicro), best.price));
  const spent = mul(rat(tokens), best.price);
  return { id: s.id, holder: s.holder, tokens, regime: best.regime, price: best.price, remainderMicro: floor(sub(rat(s.amountMicro), spent)) };
}

/** Convert every SAFT at launch; the investors together cannot be given more tokens than exist. */
export function convertSafts(safts: Saft[], tge: Tge) {
  const ids = new Set<string>(); for (const s of safts) { if (ids.has(s.id)) throw new Error(`duplicate SAFT id ${s.id}`); ids.add(s.id); }
  const results = safts.map((s) => convertSaft(s, tge));
  const totalTokens = results.reduce((a, r) => a + r.tokens, 0n);
  if (totalTokens > tge.totalSupply) throw new Error("the SAFTs convert to more tokens than exist");
  return { results, totalTokens, /** share of the supply the investors receive, as an exact fraction */ shareOfSupply: rat(totalTokens, tge.totalSupply) };
}

/** Tokens unlocked `monthsElapsed` months after launch: nothing before the cliff, then linear (the same rule as option vesting, R7). */
export const unlockedTokens = (tokens: bigint, terms: Omit<VestingTerms, "totalShares">, monthsElapsed: number) => vested({ ...terms, totalShares: tokens }, monthsElapsed);

/** The plan the contract's `convert_safts` takes: the launch inputs, the vesting every converted grant follows, and every conversion, amounts as
 *  strings, so the hash covers all of it. The contract recomputes the tokens itself and refuses the plan if any number differs. */
export function saftConversionPlan(safts: Saft[], tge: Tge, vesting: { startNs: bigint; termMonths: number; cliffMonths: number }) {
  const { results } = convertSafts(safts, tge);
  return {
    tge: { decimals: tge.decimals ?? 0, launch_price_micro: (tge.launchPriceMicro ?? 0n).toString(), total_supply: tge.totalSupply.toString() },
    vesting: { cliff_months: vesting.cliffMonths, start_ns: vesting.startNs.toString(), term_months: vesting.termMonths },
    conversions: results.map((r, i) => ({ amount_micro: safts[i].amountMicro.toString(), discount_bps: safts[i].discountBps, fdv_cap_micro: safts[i].fdvCapMicro.toString(), holder: r.holder, id: r.id, regime: r.regime, tokens: r.tokens.toString() })),
  };
}
