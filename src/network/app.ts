/**
 * InkCache node — REST API layer.
 *
 * Exposes the single-node cache core over HTTP per docs/api.md:
 *   POST   /set          { key, value, ttl? }
 *   GET    /get/:key
 *   DELETE /delete/:key
 *   POST   /invalidate   { prefix }
 *   GET    /metrics
 *   GET    /metrics/history
 *   GET    /health
 *   GET    /keys
 *   GET    /keys/stats
 *   GET    /snapshot
 *   POST   /restore      { keys: [{ key, value, ttl? }] }
 *   POST   /flush
 *   GET    /predict/:key
 *   POST   /promote
 *   GET    /version
 *
 * Builds the Express app without binding a port, so it can be started by
 * server.ts or exercised directly by supertest in tests/.
 */

import { createRequire } from "node:module";
import express from "express";
import cors from "cors";
import { AccessPredictor } from "../core/access-predictor.js";
import { CacheStore, type EvictionPolicy } from "../core/cache.js";
import { MetricsCollector } from "../core/metrics.js";
import { createAuthMiddleware } from "./auth.js";
import { resolveCorsOrigins } from "./cors.js";
import { parsePositiveInt, resolveEvictionPolicy } from "./env.js";
import { createRateLimiter } from "./rate-limit.js";
import type { PrimaryMonitorHandle } from "./primary-monitor.js";
import {
  applyReplicationOp,
  forwardToReplicas,
  resolveReplicaUrls,
  type ReplicationOp,
} from "./replication.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

export const MAX_ENTRIES = parsePositiveInt(
  process.env.INKCACHE_MAX_ENTRIES,
  512,
  "INKCACHE_MAX_ENTRIES",
);
export const NODE_ID = process.env.INKCACHE_NODE_ID ?? "node-1";
const MAX_KEY_LENGTH = parsePositiveInt(
  process.env.INKCACHE_MAX_KEY_LENGTH,
  256,
  "INKCACHE_MAX_KEY_LENGTH",
);

const EVICTION_POLICY: EvictionPolicy = resolveEvictionPolicy(process.env.INKCACHE_EVICTION_POLICY);
const EVICTION_SAMPLE_SIZE = parsePositiveInt(
  process.env.INKCACHE_EVICTION_SAMPLE,
  5,
  "INKCACHE_EVICTION_SAMPLE",
);

// Local dev origins are always allowed; INKCACHE_CORS_ORIGIN adds more
// (comma-separated) for a dashboard hosted somewhere else entirely, e.g. a
// static Vercel deploy talking to this node via VITE_API_BASE.
const CORS_ORIGINS = resolveCorsOrigins(process.env.INKCACHE_CORS_ORIGIN);

// Primary-replica replication (roadmap Sprint 3). Unset/default ("primary")
// behaves exactly like a standalone node always has -- replication is
// entirely opt-in, same as persistence above. A "replica" node rejects
// direct client writes (its state comes only from /internal/replicate and
// its one-time startup snapshot pull in server.ts) so it can't silently
// drift from its primary.
//
// `let`, not `const`: POST /promote below flips a replica to a primary
// at runtime. ES module bindings are live, so every other module that
// imports ROLE/REPLICA_URLS/PRIMARY_URL (server.ts, replication.ts's
// callers) sees the update immediately -- no getter function needed.
export let ROLE: "primary" | "replica" =
  process.env.INKCACHE_ROLE === "replica" ? "replica" : "primary";
export let REPLICA_URLS = resolveReplicaUrls(process.env.INKCACHE_REPLICA_URLS);
export let PRIMARY_URL = process.env.INKCACHE_PRIMARY_URL;

// Set by server.ts once it starts monitoring this replica's primary --
// same external-hook pattern gateway.ts uses for setHealthHandle(), so
// this module stays free of background timers on import.
let primaryMonitorHandle: PrimaryMonitorHandle | undefined;
export function setPrimaryMonitorHandle(handle: PrimaryMonitorHandle): void {
  primaryMonitorHandle = handle;
}

// Shared-secret auth + per-process rate limiting, both opt-in (unset by
// default, matching every other env-var-gated feature in this layer).
// API_KEY is exported so replication.ts/server.ts's own outgoing
// requests (forwarding to a replica, self-registering with a gateway)
// can attach it -- a shared key across the cluster only works if every
// internal caller presents it too, not just external clients.
export const API_KEY = process.env.INKCACHE_API_KEY;
const RATE_LIMIT_ENV = process.env.INKCACHE_RATE_LIMIT;
// Deliberately not parsePositiveInt(undefined, ...) with a default --
// that would silently enable rate limiting for a value nobody set. Only
// parse (and fall back to a sane default on garbage input) once the
// feature is actually opted into.
const RATE_LIMIT =
  RATE_LIMIT_ENV !== undefined
    ? parsePositiveInt(RATE_LIMIT_ENV, 100, "INKCACHE_RATE_LIMIT")
    : undefined;
const RATE_LIMIT_WINDOW_MS =
  parsePositiveInt(process.env.INKCACHE_RATE_LIMIT_WINDOW, 10, "INKCACHE_RATE_LIMIT_WINDOW") * 1000;

export const metrics = new MetricsCollector();
export const store = new CacheStore({
  maxEntries: MAX_ENTRIES,
  policy: EVICTION_POLICY,
  evictionSampleSize: EVICTION_SAMPLE_SIZE,
});
// Roadmap Sprint 5's "predictive prefetching" -- a statistical
// (Markov-bigram) access-pattern predictor, not a trained model. See
// access-predictor.ts's own header for what it is and isn't.
export const predictor = new AccessPredictor();

/** Run a cache op and record its core-level latency in microseconds. */
function timed<T>(fn: () => T): { result: T; latencyUs: number } {
  const start = process.hrtime.bigint();
  const result = fn();
  const latencyUs = Number(process.hrtime.bigint() - start) / 1000;
  return { result, latencyUs };
}

export const app = express();

// Express sends this by default, announcing the stack to anyone who asks
// for no benefit to a legitimate client — the exact kind of thing the
// hand-applied headers below exist to avoid, just missed until now.
app.disable("x-powered-by");

// A handful of the safer headers from the `helmet` playbook, applied by hand
// so a small local demo doesn't need the extra dependency.
//
// Must run before cors() below: the cors package answers an OPTIONS
// preflight itself (res.end(), no next()) without ever reaching later
// middleware, so registering this after cors() meant preflight responses
// silently shipped with none of these three headers -- caught live, by
// actually curling a preflight request and diffing its headers against
// a normal response.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

// See CORS_ORIGINS above — local dev by default, extendable for a
// separately-hosted dashboard via INKCACHE_CORS_ORIGIN.
app.use(
  cors({
    origin: CORS_ORIGINS,
  }),
);

// Rate limiting before auth: an unauthenticated client hammering this
// node with wrong keys should get throttled too, not just rejected --
// otherwise the auth check itself becomes an unbounded-cost operation
// an attacker can hit as fast as the network allows.
if (RATE_LIMIT !== undefined) {
  app.use(createRateLimiter({ limit: RATE_LIMIT, windowMs: RATE_LIMIT_WINDOW_MS }));
}
app.use(createAuthMiddleware(API_KEY));

app.use(express.json({ limit: "64kb" }));
// Malformed JSON and oversized bodies both throw inside express.json();
// without this handler Express falls through to its default HTML error
// page — which, for an oversized body specifically, includes a full stack
// trace with local filesystem paths. Caught live: a >64kb request got back
// PayloadTooLargeError's HTML page instead of JSON before this existed.
app.use(
  (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && "body" in err) {
      return res.status(400).json({ error: "malformed JSON body" });
    }
    if (err instanceof Error && "status" in err && err.status === 413) {
      return res.status(413).json({ error: "request body too large (max 64kb)" });
    }
    next(err);
  },
);

interface ValidatedEntry {
  key: string;
  value: string;
  ttl?: number;
}

/** Validates a { key, value, ttl? } shape -- shared by /set and /restore's
    per-entry validation, so a client gets identical rules and error
    messages from either endpoint instead of two hand-maintained copies
    silently drifting apart. */
function validateEntry(input: unknown): ValidatedEntry | { error: string } {
  const raw = (input ?? {}) as Record<string, unknown>;
  const { key, value } = raw;
  // null and undefined both mean "no ttl" -- GET /snapshot (and /get,
  // /keys/stats) all report a no-expiry key as ttl: null, not an omitted
  // field, so a POST /restore of that exact snapshot must accept null
  // too or every permanent key would fail to round-trip.
  const ttl = raw.ttl === null ? undefined : raw.ttl;
  if (typeof key !== "string" || key.trim().length === 0) {
    return { error: "key must be a non-empty string" };
  }
  if (key.length > MAX_KEY_LENGTH) {
    return { error: `key must be at most ${MAX_KEY_LENGTH} characters` };
  }
  if (typeof value !== "string") {
    return { error: "value must be a string" };
  }
  if (
    ttl !== undefined &&
    (typeof ttl !== "number" ||
      !Number.isFinite(ttl) ||
      ttl <= 0 ||
      // A ttl that's finite on its own (e.g. 1e306) can still overflow to
      // Infinity once converted to an absolute expiry timestamp below --
      // isExpired() then compares against Infinity forever, so the entry
      // never expires, but JSON.stringify(Infinity) serializes as null,
      // making a "TTL silently ignored" key indistinguishable on the wire
      // from one that was never given a TTL at all. Reject it outright
      // instead of accepting a request whose expiry silently never happens.
      !Number.isFinite(Date.now() + ttl * 1000))
  ) {
    return { error: "ttl must be a positive number of seconds" };
  }
  return { key, value, ttl: ttl as number | undefined };
}

/** A replica's state must only change via /internal/replicate (pushed by
    its primary) and its one-time startup snapshot pull -- accepting
    direct client writes too would let it silently drift from the
    primary it's supposed to mirror. Every write route below checks this
    first; /internal/replicate itself is exempt (see its own handler). */
function rejectIfReplica(res: express.Response): boolean {
  if (ROLE === "replica") {
    res.status(409).json({ error: "this node is a read-only replica -- write to the primary" });
    return true;
  }
  return false;
}

app.post("/set", (req, res) => {
  if (rejectIfReplica(res)) return;
  const validated = validateEntry(req.body ?? {});
  if ("error" in validated) return res.status(400).json({ error: validated.error });
  const { key, value, ttl } = validated;
  const { latencyUs } = timed(() => store.set(key, value, { ttl }));
  metrics.record("set", latencyUs);
  forwardToReplicas(REPLICA_URLS, { op: "set", key, value, ttl }, API_KEY);
  return res.json({ ok: true, key, ttl: ttl ?? null });
});

app.get("/get/:key", (req, res) => {
  const key = req.params.key;
  const { result, latencyUs } = timed(() => store.getWithTtl(key));
  metrics.record("get", latencyUs, result !== undefined);
  // Recorded regardless of hit/miss -- what a client asks for is part
  // of the access pattern even when the answer isn't cached yet.
  predictor.record(key);
  if (result === undefined) {
    return res.status(404).json({ error: "miss", key });
  }
  return res.json({ key, value: result.value, ttl: result.ttl });
});

/** Keys statistically likely to be requested next, given that `key` was
    just requested -- a hint for a client to proactively prefetch, not
    a fetch InkCache performs itself (see access-predictor.ts's header
    for why: there's no upstream store here to prefetch from). Always
    200, even for a key that's never been seen -- an empty prediction
    list is a real, valid answer ("no pattern observed yet"), not an
    error. */
app.get("/predict/:key", (req, res) => {
  const key = req.params.key;
  const topNRaw = req.query.top;
  const topN =
    typeof topNRaw === "string" && /^[1-9]\d*$/.test(topNRaw) ? Math.min(20, Number(topNRaw)) : 3;
  res.json({ key, predictions: predictor.predict(key, topN) });
});

app.delete("/delete/:key", (req, res) => {
  if (rejectIfReplica(res)) return;
  const key = req.params.key;
  const { result: deleted, latencyUs } = timed(() => store.delete(key));
  metrics.record("delete", latencyUs);
  forwardToReplicas(REPLICA_URLS, { op: "delete", key }, API_KEY);
  return res.json({ ok: true, key, deleted });
});

app.post("/invalidate", (req, res) => {
  if (rejectIfReplica(res)) return;
  const { prefix } = req.body ?? {};
  if (typeof prefix !== "string") {
    return res.status(400).json({ error: "prefix must be a string" });
  }
  if (prefix.length > MAX_KEY_LENGTH) {
    return res.status(400).json({ error: `prefix must be at most ${MAX_KEY_LENGTH} characters` });
  }
  const dropped = store.deleteByPrefix(prefix);
  forwardToReplicas(REPLICA_URLS, { op: "invalidate", prefix }, API_KEY);
  return res.json({ ok: true, prefix, dropped });
});

app.get("/keys", (_req, res) => {
  res.json({ keys: store.keys(), count: store.size });
});

app.get("/keys/stats", (_req, res) => {
  res.json({ keys: store.detailedKeys(), count: store.size });
});

app.get("/snapshot", (_req, res) => {
  const keys = store.exportEntries();
  res.json({ keys, count: keys.length });
});

app.post("/restore", (req, res) => {
  if (rejectIfReplica(res)) return;
  const { keys } = req.body ?? {};
  if (!Array.isArray(keys)) {
    return res.status(400).json({ error: "keys must be an array" });
  }
  // Validate every entry before loading any of them -- an all-or-nothing
  // restore is far less surprising than a partial one where entry #3 of 10
  // silently never made it in because entry #7 turned out to be malformed.
  const validated: ValidatedEntry[] = [];
  for (let i = 0; i < keys.length; i++) {
    const result = validateEntry(keys[i]);
    if ("error" in result) {
      return res.status(400).json({ error: `keys[${i}]: ${result.error}` });
    }
    validated.push(result);
  }
  for (const entry of validated) {
    store.set(entry.key, entry.value, { ttl: entry.ttl });
  }
  res.json({ ok: true, loaded: validated.length });
});

app.post("/flush", (_req, res) => {
  if (rejectIfReplica(res)) return;
  const dropped = store.size;
  store.clear();
  forwardToReplicas(REPLICA_URLS, { op: "flush" }, API_KEY);
  res.json({ ok: true, dropped });
});

/** Internal endpoint a primary pushes ops to on each of its replicas.
    Not part of the public API surface documented in docs/api.md's main
    table -- applies directly to the store, bypassing /set's validation
    (the primary already validated the op once) and the rejectIfReplica()
    guard above (this is exactly how a replica's state is allowed to
    change). Subject to the same auth middleware as every other route
    when INKCACHE_API_KEY is set -- forwardToReplicas() attaches it. */
app.post("/internal/replicate", (req, res) => {
  const op = req.body as ReplicationOp | undefined;
  if (!op || typeof op !== "object" || typeof op.op !== "string") {
    return res.status(400).json({ error: "malformed replication op" });
  }
  applyReplicationOp(store, op);
  return res.json({ ok: true });
});

/** Manually promotes a replica to a primary -- turns "restart with new
    env vars" into one API call. **409** if this node is already a
    primary. Clears PRIMARY_URL (this node no longer replicates from
    anyone) and sets REPLICA_URLS from the optional `replicaUrls` body
    field (defaults to none) so the newly-promoted primary can start
    forwarding writes immediately if it's told who its own replicas
    are. Does **not** reach out to any other node -- it only flips this
    node's own state. In particular, sibling replicas that were
    following the *old* primary are not told to follow this one; an
    operator (or the automatic promotion described in
    docs/api.md#automatic-primary-promotion) still has to repoint them
    via their own INKCACHE_PRIMARY_URL. */
app.post("/promote", (req, res) => {
  if (ROLE === "primary") {
    return res.status(409).json({ error: "this node is already a primary" });
  }
  const { replicaUrls } = (req.body ?? {}) as { replicaUrls?: unknown };
  let newReplicaUrls: string[] = [];
  if (replicaUrls !== undefined) {
    if (!Array.isArray(replicaUrls) || !replicaUrls.every((u) => typeof u === "string")) {
      return res.status(400).json({ error: "replicaUrls must be an array of strings" });
    }
    newReplicaUrls = replicaUrls;
  }
  ROLE = "primary";
  PRIMARY_URL = undefined;
  REPLICA_URLS = newReplicaUrls;
  console.log(
    `[inkcache] ${NODE_ID} promoted to primary` +
      (newReplicaUrls.length > 0 ? ` with ${newReplicaUrls.length} replica(s)` : ""),
  );
  return res.json({ ok: true, role: ROLE, replicaCount: REPLICA_URLS.length });
});

app.get("/metrics", (_req, res) => {
  res.json({
    node: NODE_ID,
    role: ROLE,
    ...(ROLE === "primary" ? { replicaCount: REPLICA_URLS.length } : { primaryUrl: PRIMARY_URL }),
    keys: store.size,
    maxEntries: MAX_ENTRIES,
    evictions: store.evictions,
    evictionPolicy: store.evictionPolicy,
    evictionSampleSize: EVICTION_SAMPLE_SIZE,
    ...metrics.snapshot(),
  });
});

app.get("/metrics/history", (_req, res) => {
  res.json({ samples: metrics.history });
});

app.get("/version", (_req, res) => {
  res.json({ name: "inkcache", version: pkg.version, node: NODE_ID });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    node: NODE_ID,
    role: ROLE,
    uptimeSec: metrics.uptimeSec,
    keys: store.size,
    timestamp: new Date().toISOString(),
    ...(ROLE === "replica" && primaryMonitorHandle
      ? {
          primaryHealthy: primaryMonitorHandle.isPrimaryHealthy(),
          primaryConsecutiveFailures: primaryMonitorHandle.consecutiveFailures(),
        }
      : {}),
  });
});

app.use((req, res) => {
  res.status(404).json({ error: "not found", path: req.path });
});

// Final safety net: anything an earlier handler didn't recognize (the
// malformed-body and oversized-body cases above catch the two body-parser
// errors specifically) still falls through to here rather than Express's
// default HTML error page. No stack trace or error detail in the response —
// this is what a genuinely unexpected bug looks like to a client, logged
// server-side instead where it's actually useful.
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[inkcache] unhandled error:", err);
    res.status(500).json({ error: "internal server error" });
  },
);
