/** Number of distinct simulated keys the power-law distribution below draws from. */
export const SIM_POOL_SIZE = 64;

/**
 * Power-law pick: index 0 is hottest, tail is cold — like production
 * traffic, a few keys are hot.
 *
 * Kept in its own file, separate from simulator.ts, specifically so it has
 * no dependency on lib/api.ts. api.ts throws at module load time outside
 * Vite (import.meta.env is undefined there), which made this untestable
 * via plain node:test despite being a pure function with no such need —
 * the same problem lib/errors.ts was split out to solve.
 */
export function skewedKey(): string {
  const idx = Math.floor(SIM_POOL_SIZE * Math.pow(Math.random(), 2.4));
  return `sim:user:${idx}`;
}
