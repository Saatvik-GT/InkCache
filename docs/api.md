# InkCache Node — API Reference

Base URL for a locally running node: `http://localhost:8080`
(the dashboard reaches the same node through the `/api` dev proxy).

## POST /set

Store a value, optionally with a TTL.

```bash
curl -X POST http://localhost:8080/set \
  -H "Content-Type: application/json" \
  -d '{"key":"user:1","value":"Saatvik","ttl":300}'
```

| Field | Type   | Required | Notes                              |
|-------|--------|----------|-------------------------------------|
| key   | string | yes      | non-empty, max 256 characters       |
| value | string | yes      | stored as-is                        |
| ttl   | number | no       | seconds; omit for no expiry         |

**200** `{ "ok": true, "key": "user:1", "ttl": 300 }`
**400** `{ "error": "<reason>" }`

## GET /get/:key

**200** `{ "key": "user:1", "value": "Saatvik", "ttl": 299.9 }` (`ttl` is `null` if the key never expires)
**404** `{ "error": "miss", "key": "user:1" }`

## DELETE /delete/:key

**200** `{ "ok": true, "key": "user:1", "deleted": true }`

## GET /keys

List every currently active (non-expired) key.

**200** `{ "keys": ["user:1", "user:2"], "count": 2 }`

## GET /keys/stats

Same as `/keys`, but with per-key access counts and remaining TTL —
one pass over the store, not N calls. Backs the dashboard's heat map.

**200**
```json
{
  "keys": [
    { "key": "user:1", "hits": 12, "ttl": null },
    { "key": "user:2", "hits": 0, "ttl": 284.7 }
  ],
  "count": 2
}
```

## POST /flush

Clear the entire store. Intended for local dev/demo use.

**200** `{ "ok": true, "dropped": 2 }`

## GET /metrics

**200**
```json
{
  "node": "node-1",
  "keys": 12,
  "maxEntries": 512,
  "evictions": 0,
  "evictionPolicy": "access-aware",
  "evictionSampleSize": 5,
  "uptimeSec": 84.2,
  "hits": 40,
  "misses": 5,
  "hitRate": 0.888,
  "sets": 12,
  "deletes": 1,
  "opsPerSec": 3.1,
  "latency": { "avgUs": 47.7, "p95Us": 85.3, "samples": 58 }
}
```

`evictionPolicy` is `"access-aware"` (default) or `"lru"` — see
[Eviction policy](#eviction-policy) below.

## GET /health

**200** `{ "status": "ok", "node": "node-1", "uptimeSec": 84.2, "keys": 12, "timestamp": "..." }`

## GET /version

**200** `{ "name": "inkcache", "version": "0.1.0", "node": "node-1" }`

## Errors

Unknown routes return a JSON `404`, and malformed JSON bodies return a JSON
`400` — neither falls through to Express's default HTML error page.

## Eviction policy

Configured via environment variables when starting the node (`npm run
dev:node` / `npm run start:node`):

| Variable                     | Default        | Notes                                    |
|-------------------------------|----------------|-------------------------------------------|
| `INKCACHE_MAX_ENTRIES`        | `512`          | capacity before eviction kicks in         |
| `INKCACHE_EVICTION_POLICY`    | `access-aware` | `access-aware` or `lru`                   |
| `INKCACHE_EVICTION_SAMPLE`    | `5`            | candidate window size for `access-aware`  |

**`access-aware`** samples the `INKCACHE_EVICTION_SAMPLE` least-recently-used
keys and evicts whichever of *those* was read the fewest times, instead of
always dropping the single oldest key. A key that's genuinely hot survives a
brief cold spell; a key nobody reads gets reclaimed first even if something
slightly older is technically "more LRU". This is a frequency-over-a-
recency-window heuristic (the same family of idea as W-TinyLFU's window
admission) — not a trained or learned model — and the scan is bounded to the
sample size, never the whole store.

**`lru`** is the original strict behavior: always evict the single
least-recently-used key, full stop.
