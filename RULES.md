# RULES.md — Rounds equity math

Code follows this file. Change the rules here first. Status: DRAFT (M0). The SAFE clause citations are TODO until the YC post-money SAFE text is read (open question 1).

## R1 Units
- Shares: integers (BigInt). Money: integer micro-dollars (1 USD = 1_000_000). Ratios: exact rationals {num, den} in BigInt. No floating point.
- Price per share is micro-dollars per share, rounded DOWN to 4 decimals of a dollar (i.e. a multiple of 100 micro-dollars).
- Shares round DOWN. Every rounding remainder is reported in the result, never dropped.

## R2 Capitalization before the round
N = issued shares + granted options + unissued pool (before the round). SAFE shares and the round's pool top-up are NOT in N.

## R3 Post-money SAFE, cap only
p_i = A_i / C_i. Sum(p_i) must be < 1, else reject.
Cap_pre = N / (1 - sum p_i)   (includes SAFE shares, excludes pool top-up)
SAFE_i shares = floor(p_i * Cap_pre); conversion price = C_i / Cap_pre.
GV-1: N = 8,750,000; sum p = 0.125; Cap_pre = 10,000,000; SAFE1 = 1,000,000 @ $0.50; SAFE2 = 250,000 @ $1.00.

## R4 SAFE with discount
Converts at min(cap price, round price * (1 - d_i)). Round price depends on SAFE shares, so solve by exact-rational fixed-point iteration until no SAFE changes regime and share counts are stable; fail loudly after 1,000 iterations. Cross-check cap-only case against R3 closed form.

## R5 Shadow preferred
Each converted SAFE becomes its own preferred class with original issue price = conversion price, 1x non-participating. Preference = purchase amount (up to rounding).

## R6 Priced round
Inputs: pre-money V, new money I (per investor I_k), pool target t (share of post-round fully diluted). V' = V + I.
X = issued + granted options + SAFE shares (unissued pool excluded).
Pool after = t * FD_post, FD_post = V'/P, so with pool top-up T and pool before B: P = V / (X + B + T), T = (t*V'/P) - B.
Derivation: X + B + T = V/P (top-up in pre-money) and B + T = t*V'/P, so X = (V - t*V')/P and P = (V - t*V')/X, then T = floor(t*V'/P) - B. If T < 0: T = 0 and P = V / (X + B).
New investor k gets floor(I_k / P) shares. FD_post differs from V'/P only within rounding; the engine reports the difference.
GV-1: V=21M, I=9M, X=9,000,000, B=1,000,000, T=500,000, P=$2.00, Fund = 4,500,000.

## R7 Vesting and options
Default 48 months, 12-month cliff: 25% at cliff, remainder monthly (linear per month, floor). Exercise cost = strike * shares. Termination: unvested return to pool; vested options exercisable for 90 days (default).

## R8 Exit waterfall (non-participating preferred)
Sort preferred classes by preference per as-converted share ascending. For k = 0..n: lowest k convert, others take preference (pro rata in rank order if proceeds are insufficient; pari passu by default), remainder split among common + converted pro rata. Choose the unique consistent k: every converter gets >= its preference per share, every non-converter would get less by converting. Options exercise only if per-share payout > strike; cash exercise adds strike to proceeds. Unissued pool receives nothing.

## R9 Plan hash
sha256 of RFC 8785 canonical JSON of the plan, all amounts as strings.

## Golden vectors
vectors/gv-1.json, vectors/gv-2.json (hand-checked against R3, R6, R8 on 2026-11-06). TODO: add five more (discount-only SAFE; cap+discount each winning; no top-up; down round below caps; exit with out-of-the-money option).

## Clarification (M1)
Cap_pre depends on which SAFEs convert at cap vs discount; A_i/C_i of the pre-round capitalization holds only when every SAFE is in the cap regime. GV-3 (discount-only, $2.1612 price, 578,382 SAFE shares) is in test/gv-discount.test.ts.
