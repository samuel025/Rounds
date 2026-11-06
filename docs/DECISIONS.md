# DECISIONS
- 2026-11-06: npm instead of pnpm (not installed). vitest + fast-check for tests.
- 2026-11-06 (M1): Round price solved as P = (V - t*V')/X (derived from X + pool_after = V/P, pool_after = t*V'/P), floored to 4 dp each iteration; SAFE regimes and Cap_pre re-solved per iterate until the price is a fixed point. If top-up would be negative, P = V/(X+B).
- 2026-11-06 (M1): P2 (SAFE holds A/C of pre-round cap) only holds when every SAFE converts at its cap; with a mixed-regime or down round the discount-regime SAFEs enlarge Cap_pre, so the property is checked only on all-cap outcomes. Recorded as a RULES.md clarification.
- 2026-11-06 (spike): near-cli-rs stores demo keys in ~/.near-credentials (legacy keychain), not .state/; they are throwaway testnet keys and never enter the repo. Account names/ids live in .state/suffix.
- 2026-11-06 (M2): GV-2 SAFE 2 shows $305,555.56 although the micro-dollar value floors to .55; vector amounts are rounded half-up to the cent for display only (see RULES.md).
- 2026-11-06 (M2): shortfall dust is reported as remainder, not paid to common (found by P7 monotonicity).
