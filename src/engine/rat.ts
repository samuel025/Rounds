export type Rat = { num: bigint; den: bigint };
const gcd = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
export const rat = (num: bigint, den: bigint = 1n): Rat => {
  if (den === 0n) throw new Error("zero denominator");
  if (den < 0n) { num = -num; den = -den; }
  const g = gcd(num, den) || 1n;
  return { num: num / g, den: den / g };
};
export const add = (a: Rat, b: Rat) => rat(a.num * b.den + b.num * a.den, a.den * b.den);
export const sub = (a: Rat, b: Rat) => rat(a.num * b.den - b.num * a.den, a.den * b.den);
export const mul = (a: Rat, b: Rat) => rat(a.num * b.num, a.den * b.den);
export const div = (a: Rat, b: Rat) => rat(a.num * b.den, a.den * b.num);
export const floor = (a: Rat): bigint => { const q = a.num / a.den; return a.num % a.den !== 0n && a.num < 0n ? q - 1n : q; };
export const cmp = (a: Rat, b: Rat): number => { const l = a.num * b.den, r = b.num * a.den; return l < r ? -1 : l > r ? 1 : 0; };
export const eq = (a: Rat, b: Rat) => cmp(a, b) === 0;
