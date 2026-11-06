# DECISIONS
- 2026-11-06: npm instead of pnpm (not installed). vitest + fast-check for tests.
- 2026-11-06 (M1): Round price solved as P = (V - t*V')/X (derived from X + pool_after = V/P, pool_after = t*V'/P), floored to 4 dp each iteration; SAFE regimes and Cap_pre re-solved per iterate until the price is a fixed point. If top-up would be negative, P = V/(X+B).
- 2026-11-06 (M1): P2 (SAFE holds A/C of pre-round cap) only holds when every SAFE converts at its cap; with a mixed-regime or down round the discount-regime SAFEs enlarge Cap_pre, so the property is checked only on all-cap outcomes. Recorded as a RULES.md clarification.
