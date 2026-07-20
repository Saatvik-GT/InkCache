/**
 * InkCache node — REST API layer.
 *
 * Exposes the single-node cache core over HTTP per docs/api.md:
 *   POST   /set          { key, value, ttl? }
 *   GET    /get/:key
 *   DELETE /delete/:key
 *   GET    /metrics
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

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

const MAX_ENTRIES = Number(process.env.INKCACHE_MAX_ENTRIES ?? 512);
const NODE_ID = process.env.INKCACHE_NODE_ID ?? "node-1";
const MAX_KEY_LENGTH = 256;

const EVICTION_POLICY: EvictionPolicy =
  process.env.INKCACHE_EVICTION_POLICY === "lru" ? "lru" : "access-aware";
const EVICTION_SAMPLE_SIZE = Number(process.env.INKCACHE_EVICTION_SAMPLE ?? 5);

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

// See CORS_ORIGINS above — local dev by default, extendable for a
// separately-hosted dashboard via INKCACHE_CORS_ORIGIN.
app.use(
  cors({
    origin: CORS_ORIGINS,
  }),
);

// A handful of the safer headers from the `helmet` playbook, applied by hand
// so a small local demo doesn't need the extra dependency.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.use(express.json({ limit: "64kb" }));
// Malformed JSON bodies throw inside express.json(); without this handler
// Express falls through to its default HTML error page.
app.use(
  (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && "body" in err) {
      return res.status(400).json({ error: "malformed JSON body" });
    }
    next(err);
  },
);

app.post("/set", (req, res) => {
  const { key, value, ttl } = req.body ?? {};
  if (typeof key !== "string" || key.trim().length === 0) {
    return res.status(400).json({ error: "key must be a non-empty string" });
  }
  if (key.length > MAX_KEY_LENGTH) {
    return res.status(400).json({ error: `key must be at most ${MAX_KEY_LENGTH} characters` });
  }
  if (typeof value !== "string") {
    return res.status(400).json({ error: "value must be a string" });
  }
  if (ttl !== undefined && (typeof ttl !== "number" || ttl <= 0)) {
    return res.status(400).json({ error: "ttl must be a positive number of seconds" });
  }
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
