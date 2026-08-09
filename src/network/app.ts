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
 *   POST   /flush
 *   GET    /version
 *
 * Builds the Express app without binding a port, so it can be started by
 * server.ts or exercised directly by supertest in tests/.
 */

import { createRequire } from "node:module";
import express from "express";
import cors from "cors";
import { CacheStore, type EvictionPolicy } from "../core/cache.js";
import { MetricsCollector } from "../core/metrics.js";
import { resolveCorsOrigins } from "./cors.js";
import { parsePositiveInt, resolveEvictionPolicy } from "./env.js";

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

export const metrics = new MetricsCollector();
export const store = new CacheStore({
  maxEntries: MAX_ENTRIES,
  policy: EVICTION_POLICY,
  evictionSampleSize: EVICTION_SAMPLE_SIZE,
});

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
  const { key, value, ttl } = (input ?? {}) as Record<string, unknown>;
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

app.post("/set", (req, res) => {
  const validated = validateEntry(req.body ?? {});
  if ("error" in validated) return res.status(400).json({ error: validated.error });
  const { key, value, ttl } = validated;
  const { latencyUs } = timed(() => store.set(key, value, { ttl }));
  metrics.record("set", latencyUs);
  return res.json({ ok: true, key, ttl: ttl ?? null });
});

app.get("/get/:key", (req, res) => {
  const key = req.params.key;
  const { result: value, latencyUs } = timed(() => store.get(key));
  metrics.record("get", latencyUs, value !== undefined);
  if (value === undefined) {
    return res.status(404).json({ error: "miss", key });
  }
  return res.json({ key, value, ttl: store.ttl(key) ?? null });
});

app.delete("/delete/:key", (req, res) => {
  const key = req.params.key;
  const { result: deleted, latencyUs } = timed(() => store.delete(key));
  metrics.record("delete", latencyUs);
  return res.json({ ok: true, key, deleted });
});

app.post("/invalidate", (req, res) => {
  const { prefix } = req.body ?? {};
  if (typeof prefix !== "string") {
    return res.status(400).json({ error: "prefix must be a string" });
  }
  if (prefix.length > MAX_KEY_LENGTH) {
    return res.status(400).json({ error: `prefix must be at most ${MAX_KEY_LENGTH} characters` });
  }
  const dropped = store.deleteByPrefix(prefix);
  return res.json({ ok: true, prefix, dropped });
});

app.get("/keys", (_req, res) => {
  res.json({ keys: store.keys(), count: store.size });
});

app.get("/keys/stats", (_req, res) => {
  res.json({ keys: store.detailedKeys(), count: store.size });
});

app.post("/flush", (_req, res) => {
  const dropped = store.size;
  store.clear();
  res.json({ ok: true, dropped });
});

app.get("/metrics", (_req, res) => {
  res.json({
    node: NODE_ID,
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
    uptimeSec: metrics.uptimeSec,
    keys: store.size,
    timestamp: new Date().toISOString(),
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
