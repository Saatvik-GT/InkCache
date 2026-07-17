/**
 * InkCache node — REST API layer.
 *
 * Exposes the single-node cache core over HTTP per docs/api.md:
 *   POST   /set          { key, value, ttl? }
 *   GET    /get/:key
 *   DELETE /delete/:key
 */

import express from "express";
import cors from "cors";
import { CacheStore } from "../core/cache.js";

const PORT = Number(process.env.INKCACHE_PORT ?? 8080);
const MAX_ENTRIES = Number(process.env.INKCACHE_MAX_ENTRIES ?? 512);

export const store = new CacheStore({ maxEntries: MAX_ENTRIES });
store.startSweeper();

const app = express();
app.use(cors());
app.use(express.json());

app.post("/set", (req, res) => {
  const { key, value, ttl } = req.body ?? {};
  if (typeof key !== "string" || key.length === 0) {
    return res.status(400).json({ error: "key must be a non-empty string" });
  }
  if (typeof value !== "string") {
    return res.status(400).json({ error: "value must be a string" });
  }
  if (ttl !== undefined && (typeof ttl !== "number" || ttl <= 0)) {
    return res.status(400).json({ error: "ttl must be a positive number of seconds" });
  }
  store.set(key, value, { ttl });
  return res.json({ ok: true, key, ttl: ttl ?? null });
});

app.get("/get/:key", (req, res) => {
  const key = req.params.key;
  const value = store.get(key);
  if (value === undefined) {
    return res.status(404).json({ error: "miss", key });
  }
  return res.json({ key, value, ttl: store.ttl(key) ?? null });
});

app.delete("/delete/:key", (req, res) => {
  const key = req.params.key;
  const deleted = store.delete(key);
  return res.json({ ok: true, key, deleted });
});

app.listen(PORT, () => {
  console.log(`[inkcache] node listening on http://localhost:${PORT} (maxEntries=${MAX_ENTRIES})`);
});
