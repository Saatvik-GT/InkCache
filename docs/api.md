# InkCache Node — API Reference

Base URL for a locally running node: `http://localhost:8080`
(the dashboard reaches the same node through the `/api` dev proxy in
local dev, or a build-time `VITE_API_BASE` when deployed separately —
see [Deployment](../readme.md#deployment) in the root README).

Every response, success or error, is `application/json` — see
[Errors](#errors) below for the full set of error cases and status codes.

## POST /set

Store a value, optionally with a TTL.

```bash
curl -X POST http://localhost:8080/set \
  -H "Content-Type: application/json" \
  -d '{"key":"user:1","value":"Saatvik","ttl":300}'
```

| Field | Type   | Required | Notes                                                     |
| ----- | ------ | -------- | --------------------------------------------------------- |
| key   | string | yes      | non-empty, max 256 characters (`INKCACHE_MAX_KEY_LENGTH`) |
| value | string | yes      | stored as-is                                              |
| ttl   | number | no       | seconds; omit for no expiry                               |

**200** `{ "ok": true, "key": "user:1", "ttl": 300 }` (`ttl` is `null` in the
response if you omit it in the request — it never expires)
**400** `{ "error": "<reason>" }`

## GET /get/:key

**200** `{ "key": "user:1", "value": "Saatvik", "ttl": 299.9 }` (`ttl` is `null` if the key never expires)
**404** `{ "error": "miss", "key": "user:1" }`

## DELETE /delete/:key

**200** `{ "ok": true, "key": "user:1", "deleted": true }` (`deleted` is
`false`, still **200**, if the key never existed — this is not an error)

## POST /invalidate

Delete every key starting with a given prefix — bulk invalidation without
knowing the exact key set in advance (e.g. dropping every cache entry for
one user: `user:42:*`).

```bash
curl -X POST http://localhost:8080/invalidate \
  -H "Content-Type: application/json" \
  -d '{"prefix":"user:42:"}'
```

| Field  | Type   | Required | Notes                                                        |
| ------ | ------ | -------- | ------------------------------------------------------------ |
| prefix | string | yes      | max 256 characters; `""` matches every key, same as `/flush` |

**200** `{ "ok": true, "prefix": "user:42:", "dropped": 3 }` (`dropped` is
`0`, still **200**, if nothing matched — this is not an error)
**400** `{ "error": "<reason>" }`

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

## GET /snapshot

Every live key's value and remaining TTL — one pass over the store, not
N calls. Pair with `POST /restore` to save/reload the cache's contents,
e.g. across a restart or between environments.

**200**

```json
{
  "keys": [
    { "key": "user:1", "value": "Saatvik", "ttl": null },
    { "key": "user:2", "value": "temp", "ttl": 284.7 }
  ],
  "count": 2
}
```

Unlike `/keys/stats`, hit counts are deliberately omitted — a restored
key starts fresh rather than inheriting stale popularity from a previous
run.

## POST /restore

Load a `keys` array (the exact shape `GET /snapshot` returns) back into
the store via the same validation `/set` uses per entry.

```bash
curl -X POST http://localhost:8080/restore \
  -H "Content-Type: application/json" \
  -d '{"keys":[{"key":"user:1","value":"Saatvik","ttl":null}]}'
```

| Field | Type  | Required | Notes                                                    |
| ----- | ----- | -------- | -------------------------------------------------------- |
| keys  | array | yes      | each entry: `{ key, value, ttl? }`, same rules as `/set` |

**200** `{ "ok": true, "loaded": 1 }`
**400** `{ "error": "<reason>" }` — the whole request is rejected if **any**
entry fails validation; nothing is loaded partially. `ttl: null` (what
`/snapshot` reports for a no-expiry key) and an omitted `ttl` are both
accepted as "no expiry".

## POST /flush

Clear the entire store. Intended for local dev/demo use.

**200** `{ "ok": true, "dropped": 2 }`

Only removes the stored keys — the cumulative counters in `/metrics`
(`hits`, `misses`, `sets`, `deletes`, `evictions`) are lifetime stats and
are not reset by this.

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

`evictionPolicy` is `"access-aware"` (default), `"lru"`, or `"lfu"` — see
[Eviction policy](#eviction-policy) below.

`opsPerSec` is throughput over a rolling 10-second window (all op types:
get/set/delete), not a lifetime average — it responds to a burst or a
lull within seconds rather than smoothing over the whole uptime.
`latency.samples` is capped at the last 512 recorded operations (a ring
buffer), also for the same reason: percentiles that reflect recent
behaviour, not history from hours ago.

## GET /metrics/history

A periodic history of `/metrics`' own snapshot, so hit-rate/evictions/
latency trend over time is visible instead of only ever showing the
current instant. Sampled every 10s (in-memory only, not persisted —
restarting the node resets it), capped at the last 360 samples (1 hour).

**200**

```json
{
  "samples": [
    {
      "at": 1717000000000,
      "uptimeSec": 10.0,
      "hits": 4,
      "misses": 1,
      "hitRate": 0.8,
      "sets": 2,
      "deletes": 0,
      "opsPerSec": 0.7,
      "latency": { "avgUs": 41.2, "p95Us": 88.0, "samples": 7 }
    }
  ]
}
```

`samples` is empty immediately after startup and stays empty until the
first 10s interval has actually elapsed. Each entry has the exact same
shape as `/metrics` itself, plus `at` (epoch ms).

## GET /health

**200** `{ "status": "ok", "node": "node-1", "uptimeSec": 84.2, "keys": 12, "timestamp": "..." }`

## GET /version

**200** `{ "name": "inkcache", "version": "0.1.0", "node": "node-1" }`

## Errors

| Status | When                              | Body                                               |
| ------ | --------------------------------- | -------------------------------------------------- |
| 400    | malformed JSON body               | `{ "error": "malformed JSON body" }`               |
| 413    | request body over 64kb            | `{ "error": "request body too large (max 64kb)" }` |
| 404    | `GET /get/:key` on a missing key  | `{ "error": "miss", "key": "..." }`                |
| 404    | unknown route                     | `{ "error": "not found", "path": "..." }`          |
| 500    | genuinely unexpected server error | `{ "error": "internal server error" }`             |

None of these fall through to Express's default HTML error page — every
error case, expected or not, is caught and returned as JSON with no
internal detail (stack traces, file paths) leaked to the client.

## Security headers

Express's default `X-Powered-By: Express` header is disabled (no reason to
announce the stack to every client), and every response carries three more
headers applied by hand (a small local demo doesn't need a full `helmet`
dependency for three lines):

| Header                   | Value         | Why                                                                          |
| ------------------------ | ------------- | ---------------------------------------------------------------------------- |
| `X-Content-Type-Options` | `nosniff`     | stops the browser from MIME-sniffing a response as something other than JSON |
| `X-Frame-Options`        | `DENY`        | the API has no UI of its own worth framing, so disallow it outright          |
| `Referrer-Policy`        | `no-referrer` | baseline hardening — this is a JSON API, not a page that links elsewhere     |

"Every response" includes CORS preflight (`OPTIONS`) requests — the
headers middleware runs before `cors()` in the stack specifically so
that's true, since `cors()` answers a preflight itself without ever
reaching later middleware.

## Eviction policy

All node configuration is via environment variables, set before starting
the node (`npm run dev:node` / `npm run start:node`):

| Variable                   | Default        | Notes                                    |
| -------------------------- | -------------- | ---------------------------------------- |
| `INKCACHE_PORT`            | `8080`         | HTTP port the node listens on            |
| `INKCACHE_NODE_ID`         | `node-1`       | label reported in `/health`/`/metrics`   |
| `INKCACHE_MAX_ENTRIES`     | `512`          | capacity before eviction kicks in        |
| `INKCACHE_EVICTION_POLICY` | `access-aware` | `access-aware`, `lru`, or `lfu`          |
| `INKCACHE_EVICTION_SAMPLE` | `5`            | candidate window size for `access-aware` |
| `INKCACHE_MAX_KEY_LENGTH`  | `256`          | longest key `/set` will accept           |
| `INKCACHE_CORS_ORIGIN`     | _(none)_       | comma-separated extra allowed origins    |

`INKCACHE_CORS_ORIGIN` is only needed when the dashboard is hosted
separately from this node (see `VITE_API_BASE` in
[`src/dashboard/.env.example`](../src/dashboard/.env.example)) — local dev
origins (`localhost:5173` and `127.0.0.1:5173`) are always allowed
regardless.

The four numeric variables (`PORT`, `MAX_ENTRIES`, `EVICTION_SAMPLE`,
`MAX_KEY_LENGTH`) are validated as positive integers — set one to
something else (a typo, an empty string, a negative number) and the node
logs a warning and falls back to its default instead of silently
misbehaving. `EVICTION_POLICY` gets the same treatment: anything other
than exactly `lru`, `access-aware`, or `lfu` logs a warning and falls back
to `access-aware` rather than silently accepting a typo.

**`access-aware`** samples the `INKCACHE_EVICTION_SAMPLE` least-recently-used
keys and evicts whichever of _those_ was read the fewest times, instead of
always dropping the single oldest key. A key that's genuinely hot survives a
brief cold spell; a key nobody reads gets reclaimed first even if something
slightly older is technically "more LRU". This is a frequency-over-a-
recency-window heuristic (the same family of idea as W-TinyLFU's window
admission) — not a trained or learned model — and the scan is bounded to the
sample size, never the whole store.

**`lru`** is the original strict behavior: always evict the single
least-recently-used key, full stop.

**`lfu`** is strict frequency-only eviction: scan every live entry and evict
whichever has been read the fewest times, ignoring recency entirely — unlike
`access-aware`, which only ever considers the `INKCACHE_EVICTION_SAMPLE`
least-recently-used candidates. This means `lfu` can correctly evict a truly
cold key even when something more recently touched (but still barely-read)
sits ahead of it in recency order, at the cost of an O(n) scan per eviction
instead of the other two policies' bounded scans.
