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
  "role": "primary",
  "replicaCount": 0,
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
[Eviction policy](#eviction-policy) below. `role` is `"primary"` or
`"replica"` — a primary node reports `replicaCount`, a replica reports
`primaryUrl` instead. See [Replication](#replication).

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

**200** `{ "status": "ok", "node": "node-1", "role": "primary", "uptimeSec": 84.2, "keys": 12, "timestamp": "..." }`

`role` is `"primary"` (default) or `"replica"` — see [Replication](#replication) below.

## GET /version

**200** `{ "name": "inkcache", "version": "0.1.0", "node": "node-1" }`

## Errors

| Status | When                                    | Body                                                                      |
| ------ | --------------------------------------- | ------------------------------------------------------------------------- |
| 400    | malformed JSON body                     | `{ "error": "malformed JSON body" }`                                      |
| 413    | request body over 64kb                  | `{ "error": "request body too large (max 64kb)" }`                        |
| 404    | `GET /get/:key` on a missing key        | `{ "error": "miss", "key": "..." }`                                       |
| 404    | unknown route                           | `{ "error": "not found", "path": "..." }`                                 |
| 409    | a write sent directly to a replica node | `{ "error": "this node is a read-only replica -- write to the primary" }` |
| 500    | genuinely unexpected server error       | `{ "error": "internal server error" }`                                    |

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

| Variable                    | Default        | Notes                                                                                        |
| --------------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| `INKCACHE_PORT`             | `8080`         | HTTP port the node listens on                                                                |
| `INKCACHE_NODE_ID`          | `node-1`       | label reported in `/health`/`/metrics`                                                       |
| `INKCACHE_MAX_ENTRIES`      | `512`          | capacity before eviction kicks in                                                            |
| `INKCACHE_EVICTION_POLICY`  | `access-aware` | `access-aware`, `lru`, or `lfu`                                                              |
| `INKCACHE_EVICTION_SAMPLE`  | `5`            | candidate window size for `access-aware`                                                     |
| `INKCACHE_MAX_KEY_LENGTH`   | `256`          | longest key `/set` will accept                                                               |
| `INKCACHE_CORS_ORIGIN`      | _(none)_       | comma-separated extra allowed origins                                                        |
| `INKCACHE_PERSIST_PATH`     | _(none)_       | file path to save/load the cache's contents across restarts                                  |
| `INKCACHE_PERSIST_INTERVAL` | `60`           | seconds between auto-saves (only used if `INKCACHE_PERSIST_PATH` is set)                     |
| `INKCACHE_ROLE`             | `primary`      | `primary` or `replica` — see [Replication](#replication)                                     |
| `INKCACHE_REPLICA_URLS`     | _(none)_       | comma-separated replica base URLs (primary only)                                             |
| `INKCACHE_PRIMARY_URL`      | _(none)_       | this node's primary's base URL (replica only)                                                |
| `INKCACHE_GATEWAY_URL`      | _(none)_       | a cluster gateway's base URL to self-register with — see [Cluster gateway](#cluster-gateway) |
| `INKCACHE_SELF_URL`         | _(none)_       | this node's own externally-reachable base URL (required with `INKCACHE_GATEWAY_URL`)         |

`INKCACHE_CORS_ORIGIN` is only needed when the dashboard is hosted
separately from this node (see `VITE_API_BASE` in
[`src/dashboard/.env.example`](../src/dashboard/.env.example)) — local dev
origins (`localhost:5173` and `127.0.0.1:5173`) are always allowed
regardless.

`INKCACHE_PERSIST_PATH` is unset (disabled) by default — the cache is
in-memory only and restarting the process loses everything, same as
without this variable at all. Set it to a file path to opt in: the node
loads that file on startup (if it exists), saves to it every
`INKCACHE_PERSIST_INTERVAL` seconds, and does one final best-effort save
on a graceful `SIGINT`/`SIGTERM` shutdown. Writes are atomic (a temp file

- rename, not a direct write), so a process killed mid-save never leaves
  a corrupt file — a missing or unparseable file just starts the node
  empty, with a warning, rather than crashing.

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

## Cluster gateway

A separate process (roadmap Sprint 4) that shards keys across a fixed set
of InkCache nodes via consistent hashing, so a client can talk to one
address instead of knowing which node owns which key. The gateway holds
no cache state of its own — it's pure routing, proxying every request to
the real node and relaying that node's response back verbatim.

```bash
# three cache nodes
INKCACHE_PORT=8080 npm run start:node &
INKCACHE_PORT=8081 npm run start:node &
INKCACHE_PORT=8082 npm run start:node &

# gateway in front of all three
INKCACHE_CLUSTER_NODES=http://localhost:8080,http://localhost:8081,http://localhost:8082 \
  npm run start:gateway

curl -X POST http://localhost:8090/set -H "Content-Type: application/json" \
  -d '{"key":"user:1","value":"Saatvik"}'
curl http://localhost:8090/get/user:1
```

| Variable                           | Default  | Notes                                                  |
| ---------------------------------- | -------- | ------------------------------------------------------ |
| `INKCACHE_GATEWAY_PORT`            | `8090`   | HTTP port the gateway listens on                       |
| `INKCACHE_CLUSTER_NODES`           | _(none)_ | comma-separated base URLs of the nodes to route across |
| `INKCACHE_GATEWAY_HEALTH_INTERVAL` | `2000`   | ms between health checks against every cluster node    |
| `INKCACHE_CORS_ORIGIN`             | _(none)_ | same meaning as on a cache node                        |

Routes:

| Method | Endpoint              | Behaviour                                                 |
| ------ | --------------------- | --------------------------------------------------------- |
| POST   | `/set`                | Proxies to the node `key` hashes to                       |
| GET    | `/get/:key`           | Proxies to the node `key` hashes to                       |
| DELETE | `/delete/:key`        | Proxies to the node `key` hashes to                       |
| GET    | `/cluster/route/:key` | Which node owns `key`, without performing the read/write  |
| GET    | `/cluster/nodes`      | Every currently-known node and its current health         |
| POST   | `/cluster/nodes`      | Registers a new node at runtime — `{ "url": "..." }`      |
| DELETE | `/cluster/nodes`      | Deregisters a node — `{ "url": "..." }`, no-op if unknown |
| GET    | `/health`             | The gateway's own health (not proxied)                    |

**503** `{ "error": "no cluster nodes configured" }` from any routed
endpoint if `INKCACHE_CLUSTER_NODES` is unset or empty (or every
configured node is currently unhealthy). **502**
`{ "error": "node <url> unreachable: <reason>" }` if the node a key
hashes to doesn't answer.

`GET /cluster/nodes` response shape:

```json
{
  "nodes": [
    { "url": "http://localhost:8080", "healthy": true },
    { "url": "http://localhost:8081", "healthy": false }
  ],
  "healthyCount": 1,
  "count": 2
}
```

Consistent hashing (`src/core/hashring.ts`, MD5 into a sorted ring with
150 virtual points per node) means adding or removing a node only
remaps the keys that were on that node, not the whole keyspace —
unlike `hash(key) % nodeCount`, where every key remaps the moment the
node count changes.

**Failure handling** (roadmap Sprint 4, part 4): the gateway actively
polls every known node's `/health` on `INKCACHE_GATEWAY_HEALTH_INTERVAL`
(default 2s, 1s request timeout per check). A node that fails a check is
immediately pulled out of the hashing ring — new requests for keys that
used to route to it land on the next node clockwise instead of 502ing
against a dead node — and put back the moment it starts answering again.
This is deliberately simple and not flap-damped: one failed check
removes a node, one successful check restores it, with no
failure-count threshold or backoff.

**Node discovery** (roadmap Sprint 4, final piece): `INKCACHE_CLUSTER_NODES`
is only the gateway's _initial_ node set, not a ceiling — `POST /cluster/nodes`
adds a node at runtime (**409** if it's already registered, **400** if
`url` is missing/not a string) and `DELETE /cluster/nodes` removes one
(a no-op, not an error, if it's already unknown). A newly-registered
node is added to both the hashing ring and the health checker
immediately, so it starts receiving traffic and being monitored on the
very next tick rather than requiring a gateway restart.

A cache node can announce itself automatically instead of an operator
curling the gateway by hand: set `INKCACHE_GATEWAY_URL` (the gateway's
base URL) and `INKCACHE_SELF_URL` (this node's own externally-reachable
base URL — not inferred from `INKCACHE_PORT`, since `localhost:PORT`
would be wrong the moment the node and gateway aren't on the same host)
on the cache node itself. It registers on startup and deregisters on a
graceful `SIGINT`/`SIGTERM` shutdown, best-effort (a node that can't
reach its gateway still starts and serves direct traffic rather than
refusing to come up):

```bash
# gateway with zero nodes configured -- nothing to route to yet
npm run start:gateway

# a node discovers itself into the running gateway
INKCACHE_PORT=8080 INKCACHE_GATEWAY_URL=http://localhost:8090 \
  INKCACHE_SELF_URL=http://localhost:8080 npm run start:node
```

This is deliberately a self-registration model, not a gossip protocol
or a service-mesh-style control plane — a node has to know its
gateway's address up front, and a gateway restart forgets every
dynamically-registered node (it starts fresh from
`INKCACHE_CLUSTER_NODES` again, same as always).

## Replication

A single-primary, best-effort replication model — one primary node, zero
or more replicas, no consensus and no strong consistency guarantee. This
is the same trade-off Redis's own default (non-Sentinel/Cluster)
replication makes: a replica can lag behind or miss an update if it's
briefly unreachable when a write happens.

**Primary** (default role, `INKCACHE_ROLE` unset or `primary`): every
successful `/set`, `/delete`, `/invalidate`, or `/flush` is forwarded,
fire-and-forget, to every URL in `INKCACHE_REPLICA_URLS` (comma-separated)
via `POST <replica-url>/internal/replicate`. Forwarding never blocks or
slows down the primary's own response — a replica that's down or slow
doesn't affect write latency, and a failed forward is only logged, not
retried (a replica that missed an op catches up on its next restart's
snapshot pull, described below). `POST /restore` is **not** forwarded —
it's a bulk local-dev/migration operation, not treated as live traffic.

**Replica** (`INKCACHE_ROLE=replica`, with `INKCACHE_PRIMARY_URL` set to
its primary's base URL): pulls a full `GET /snapshot` from its primary
once at startup (before it starts listening, with a few retries in case
the primary isn't answering yet), then applies whatever
`/internal/replicate` sends it as it arrives. A replica **rejects direct
client writes** with **409** (see [Errors](#errors)) — its state is only
supposed to change via replication, so accepting a direct write would let
it silently drift from its primary. Reads (`GET /get/:key`, `/keys`,
`/keys/stats`, `/snapshot`, `/metrics`, `/health`) all work normally on a
replica.

```bash
# terminal 1 — primary
INKCACHE_PORT=8080 INKCACHE_REPLICA_URLS=http://localhost:8081 npm run start:node

# terminal 2 — replica
INKCACHE_PORT=8081 INKCACHE_ROLE=replica INKCACHE_PRIMARY_URL=http://localhost:8080 npm run start:node
```

`POST /internal/replicate` is not part of the public API surface above —
it exists only for a primary to push ops to its replicas, applies
directly to the store (skipping `/set`'s own validation, since the
primary already validated the op once), and has no authentication, same
as every other route on this demo node (see
[docs/security-notes.md](security-notes.md)).
