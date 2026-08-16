/**
 * Primary liveness monitoring for a replica (automatic primary
 * promotion, part 2 of N). A replica already knows its primary's URL
 * (INKCACHE_PRIMARY_URL); this polls that primary's own /health on an
 * interval and tracks consecutive failures, the sensing half of
 * automatic promotion -- part 3 wires "N consecutive failures" to an
 * actual self-promotion. Deliberately split from that decision here:
 * this module only observes and reports, it never mutates ROLE itself,
 * so its behavior (and tests) don't depend on whatever promotion policy
 * gets layered on top.
 *
 * Reuses health-check.ts's pingHealthy() -- same fetch-with-timeout
 * shape the gateway already uses to check cache nodes, just aimed at a
 * single URL instead of a set.
 *
 * The optional `onFailure` callback is the seam automatic promotion
 * (part 3) hooks into: it fires after every failed check with the
 * current streak length, and server.ts is what decides whether/when
 * that streak means "promote now" -- this module still never mutates
 * ROLE, or even knows promotion exists.
 */

import { pingHealthy } from "./health-check.js";

export interface PrimaryMonitorHandle {
  stop(): void;
  /** True if the most recent check succeeded (or no check has run yet
      -- same "assume healthy until proven otherwise" reasoning
      health-check.ts's node monitoring uses, so a replica doesn't
      report its primary as down before the first tick has even had a
      chance to run). */
  isPrimaryHealthy(): boolean;
  /** How many checks in a row have failed. Resets to 0 the instant a
      check succeeds -- not a lifetime failure count, a *streak*, which
      is what a "how long has it actually been down" decision needs. */
  consecutiveFailures(): number;
}

/**
 * Starts polling `primaryUrl`'s /health every `intervalMs` (default 2s,
 * matching the gateway's own default). `/health` is always open
 * regardless of INKCACHE_API_KEY (see auth.ts), so this never needs to
 * attach an auth header the way other cross-node calls do.
 */
export function startPrimaryMonitor(
  primaryUrl: string,
  intervalMs = 2000,
  timeoutMs = 1000,
  onFailure?: (consecutiveFailures: number) => void,
): PrimaryMonitorHandle {
  let healthy = true;
  let failures = 0;

  async function check(): Promise<void> {
    const ok = await pingHealthy(primaryUrl, timeoutMs);
    if (ok) {
      if (!healthy) {
        console.log(`[inkcache] primary ${primaryUrl} is back`);
      }
      healthy = true;
      failures = 0;
    } else {
      failures++;
      healthy = false;
      console.warn(
        `[inkcache] primary ${primaryUrl} failed its health check (${failures} in a row)`,
      );
      onFailure?.(failures);
    }
  }

  const timer = setInterval(() => void check(), intervalMs);
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
    isPrimaryHealthy: () => healthy,
    consecutiveFailures: () => failures,
  };
}
