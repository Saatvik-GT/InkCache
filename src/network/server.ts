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
 *   POST   /flush
 */

import { createRequire } from "node:module";
import express from "express";
import cors from "cors";
import { CacheStore } from "../core/cache.js";
import { MetricsCollector } from "../core/metrics.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

const PORT = Number(process.env.INKCACHE_PORT ?? 8080);
const MAX_ENTRIES = Number(process.env.INKCACHE_MAX_ENTRIES ?? 512);
const NODE_ID = process.env.INKCACHE_NODE_ID ?? "node-1";

export const metrics = new MetricsCollector();
export const store = new CacheStore({ maxEntries: MAX_ENTRIES });
store.startSweeper();

/** Run a cache op and record its core-level latency in microseconds. */
function timed<T>(fn: () => T): { result: T; latencyUs: number } {
  const start = process.hrtime.bigint();
  const result = fn();
  const latencyUs = Number(process.hrtime.bigint() - start) / 1000;
  return { result, latencyUs };
}

const app = express();
// Only the Vite dev server (and its preview port) need direct access; the
// production dashboard talks to the node through the /api proxy instead.
app.use(
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
  }),
);
app.use(express.json());

const MAX_KEY_LENGTH = 256;

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

app.listen(PORT, () => {
  console.log(`[inkcache] node listening on http://localhost:${PORT} (maxEntries=${MAX_ENTRIES})`);
});
