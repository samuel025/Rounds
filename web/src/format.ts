// Money formatting stays in BigInt: micro-dollars can exceed Number's exact integer range, and prices must
// not pick up floating-point error on their way to the page.
const M = 1_000_000n;
const sign = (neg: boolean) => (neg ? "-" : "");

/** Headline amounts: nearest dollar, or cents rounded half-up when asked. */
export function usd(micro: bigint, cents = false): string {
  const neg = micro < 0n, m = neg ? -micro : micro;
  const whole = m / M, c = ((m % M) + 5_000n) / 10_000n;
  const w = (c >= 100n ? whole + 1n : whole).toLocaleString("en-US");
  if (!cents) return `${sign(neg)}$${w}`;
  return `${sign(neg)}$${w}.${(c >= 100n ? 0n : c).toString().padStart(2, "0")}`;
}

/** Exact micro-dollar amount, trailing zeros trimmed (at most 6 decimals). */
export function usdExact(micro: bigint): string {
  const neg = micro < 0n, m = neg ? -micro : micro;
  const frac = (m % M).toString().padStart(6, "0").replace(/0+$/, "");
  return `${sign(neg)}$${(m / M).toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}

/** Price per share; the engine floors it to 4 decimals (multiples of 100 micro). */
export function price4(micro: bigint): string {
  const neg = micro < 0n, m = neg ? -micro : micro;
  const units = ((m % M) + 50n) / 100n;
  const wrap = units >= 10_000n;
  const whole = wrap ? m / M + 1n : m / M;
  const frac = (wrap ? 0n : units).toString().padStart(4, "0");
  return `${sign(neg)}$${whole}.${frac}`;
}
