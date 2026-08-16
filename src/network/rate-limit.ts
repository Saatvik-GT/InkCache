/**
 * Fixed-window rate limiting, opt-in via INKCACHE_RATE_LIMIT. Per-process,
 * in-memory, keyed by client IP -- deliberately not a distributed rate
 * limiter (no shared store across a cluster's nodes), which would need
 * Redis or similar and is a different scope of feature than a demo
 * node needs. A fixed window (not sliding/token-bucket) is the simplest
 * thing that actually bounds request rate; it allows a burst right at
 * a window boundary (2x the configured limit in the worst case, one
 * burst at the end of one window and another at the start of the
 * next), a known, documented trade-off of fixed windows in exchange for
 * O(1) bookkeeping instead of a sliding log per client.
 */

import type { NextFunction, Request, Response } from "express";

export interface RateLimitOptions {
  /** Max requests allowed per client within one window. */
  limit: number;
  windowMs: number;
  /** Bounds memory under many distinct client IPs -- without this, an
      attacker (or just a lot of real traffic) sending requests from
      many different source addresses would grow this map forever.
      Oldest-inserted client is evicted first, same simple bounding
      strategy access-predictor.ts and metrics.ts's ring buffer use
      elsewhere in this codebase. */
  maxTrackedClients?: number;
}

const DEFAULT_MAX_TRACKED_CLIENTS = 10_000;

/** Always open -- see auth.ts's identical exemption for the same
    reasoning (a liveness probe is not something to throttle, and
    throttling it risks an orchestrator wrongly concluding the node is
    unhealthy). */
const EXEMPT_PATHS = new Set(["/health"]);

export function createRateLimiter(opts: RateLimitOptions) {
  const maxTrackedClients = opts.maxTrackedClients ?? DEFAULT_MAX_TRACKED_CLIENTS;
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (EXEMPT_PATHS.has(req.path)) return next();

    const key = req.ip ?? "unknown";
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      if (!bucket && buckets.size >= maxTrackedClients) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count++;
    if (bucket.count > opts.limit) {
      res.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
      res.status(429).json({ error: "rate limit exceeded" });
      return;
    }
    next();
  };
}
