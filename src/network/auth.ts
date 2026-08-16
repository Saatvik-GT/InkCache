/**
 * Shared-secret authentication, opt-in via INKCACHE_API_KEY. Deliberately
 * the simplest thing that's real security rather than security theater:
 * one shared key across the whole cluster (every cache node, replica,
 * and gateway set the same INKCACHE_API_KEY), checked with a
 * constant-time comparison against an `X-API-Key` header or an
 * `Authorization: Bearer <key>` header. No per-client keys, no
 * expiry/rotation, no scopes -- those are real gaps for a production
 * system, but building them with no real multi-tenant use case to
 * design against would be exactly the kind of speculative complexity
 * this project avoids elsewhere.
 *
 * A factory (createAuthMiddleware(apiKey)) rather than a module-level
 * singleton reading process.env itself -- callers (app.ts, gateway.ts)
 * already read their own env vars and pass resolved values into pure
 * helpers (resolveCorsOrigins, resolveEvictionPolicy, ...); this
 * matches that pattern and means the middleware is directly testable
 * with an explicit key instead of needing a module-reload dance.
 */

import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/** Always open, regardless of whether an API key is configured --
    Docker HEALTHCHECK, the gateway's own health-check.ts, and any
    orchestrator liveness probe need to reach this without credentials.
    A liveness check is not a data-access boundary. */
const EXEMPT_PATHS = new Set(["/health"]);

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on mismatched lengths rather than returning
  // false -- an unequal-length key is exactly one of the cases this
  // needs to reject, not crash on.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Extracts the presented key from either header this accepts. Only one
    is required, not both -- `X-API-Key` for a plain curl/script,
    `Authorization: Bearer` for anything that already speaks that
    convention (most HTTP client libraries). */
function presentedKey(req: Request): string | undefined {
  const header = req.header("x-api-key");
  if (header) return header;
  const auth = req.header("authorization");
  if (!auth) return undefined;
  const [scheme, token] = auth.split(" ");
  return scheme === "Bearer" && token ? token : undefined;
}

/** Builds the auth-checking middleware. `apiKey` undefined means
    auth is disabled entirely (the default -- opt-in, same as every
    other env-var-gated feature in this layer): every request passes
    through unchecked, matching how this node behaved before
    INKCACHE_API_KEY existed at all. */
export function createAuthMiddleware(apiKey: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!apiKey || EXEMPT_PATHS.has(req.path)) return next();
    const presented = presentedKey(req);
    if (!presented || !safeEqual(presented, apiKey)) {
      res.status(401).json({ error: "missing or invalid API key" });
      return;
    }
    next();
  };
}

/** Header(s) to attach to an outgoing internal request (replication
    forwarding, gateway-to-node proxying, node self-registration) so it
    isn't rejected by the target's own auth middleware. Empty object if
    no key is configured -- spreadable into a fetch()'s headers either
    way without a conditional at every call site. */
export function authHeader(apiKey: string | undefined): Record<string, string> {
  return apiKey ? { "x-api-key": apiKey } : {};
}
