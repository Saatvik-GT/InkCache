# InkCache — Architecture

This is the architecture as it actually exists today, not the
aspirational diagram in the root README (which is the project's
original pitch and still shows a still-unbuilt "Adaptive Intelligence
Layer" — that stays clearly marked as aspirational there and isn't
repeated here as if it were real). Every component below is real,
running code with tests; where something is a heuristic rather than a
learned model, or a limitation rather than a finished feature, it's
called out directly rather than glossed over.

## Processes

InkCache is three kinds of process, run independently, wired together
over plain HTTP — no message queue, no shared memory, no RPC framework:

```
                    ┌────────────────────┐
                    │       Client(s)      │
                    └──────────┬───────────┘
                               │
                 (direct)      │      (sharded)
          ┌────────────────────┼────────────────────┐
          │                                          │
          ▼                                          ▼
 ┌──────────────────┐                    ┌─────────────────────────┐
 │  Cache node        │                    │  Cluster gateway          │
 │  (server.ts)        │◄──register/──────│  (gateway-server.ts)       │
 │                     │  deregister       │                          │
 │  CacheStore         │                    │  ClusterRouter            │
 │  MetricsCollector   │                    │  (HashRing, consistent    │
 │  AccessPredictor    │                    │   hashing over known      │
 │  (persistence,      │                    │   node URLs)              │
 │   replication)      │                    │  health-check.ts          │
 └─────────┬─────────┘                    │  (polls each node's       │
           │                                │   /health, evicts/       │
           │ replicate (fire-and-forget)    │   restores it live)       │
           ▼                                └─────────────┬───────────┘
 ┌──────────────────┐                                    │
 │  Cache node          │◄────────── proxies GET/SET/DELETE ┘
 │  (INKCACHE_ROLE=      │
 │   replica)            │
 └──────────────────┘
```

- **Cache node** (`src/network/server.ts` + `app.ts`) — the actual
  key-value store. Everything in [docs/api.md](api.md) except the
  `/cluster/*` and `/internal/replicate` routes lives here. A single
  node is a complete, useful InkCache on its own; every other process
  type is optional and layers on top of this one.
- **Cluster gateway** (`src/network/gateway-server.ts` + `gateway.ts`)
  — stateless routing tier. Shards keys across a set of cache nodes via
  consistent hashing, proxying every request to the real node and
  relaying its response back verbatim. Holds no cache data itself.
- **Dashboard** (`src/dashboard`) — a static React/Vite build that
  talks to one cache node's REST API. Not a process in the same sense
  as the two above; it's a client, same as any `curl` call.

Nothing here is a distributed consensus system. There's no leader
election, no quorum, no Raft/Paxos log. Every cross-process
relationship — replica-to-primary, gateway-to-node — is a fixed,
explicitly-configured pointer (an env var), not something nodes
discover about each other through gossip. That's a real, load-bearing
design constraint, not an oversight: it keeps every piece independently
understandable and testable, at the cost of self-healing.

## Data flow: a single `GET`

1. Client sends `GET /get/user:1` — either directly to a cache node, or
   to a cluster gateway.
2. **If through a gateway**: `ClusterRouter.nodeFor("user:1")` hashes
   the key into the ring (`src/core/hashring.ts`, MD5 into 150 virtual
   points per node) and returns the node's base URL. The gateway
   proxies the request there and relays the response.
3. **At the cache node**: `CacheStore.getWithTtl()` does the actual
   lookup (single Map lookup, bumps recency/hit-count as a side
   effect), `MetricsCollector.record()` logs the latency and hit/miss,
   and `AccessPredictor.record()` updates the bigram transition table
   used by `GET /predict/:key`.
4. **If this node is a primary with replicas configured**: nothing
   changes for a `GET` — replication only forwards writes
   (`/set`/`/delete`/`/invalidate`/`/flush`), not reads. A replica
   answers `GET`s out of its own local, replicated copy of the data.

A `SET`/`DELETE`/`INVALIDATE`/`FLUSH` follows the same path but adds one
more step at the cache node: after applying the write locally, the
primary forwards the same op to every URL in `INKCACHE_REPLICA_URLS`
(`forwardToReplicas()`, fire-and-forget over HTTP) so replicas converge
without the client waiting on that fan-out.

## What's a heuristic, and what isn't

Two features intentionally sit in the "real statistical engineering,
not machine learning" category — worth being explicit about the line,
since the project's own pitch (see the root README's opening paragraph)
talks about "learning access patterns":

- **`access-aware` eviction** (`CacheStore`'s default policy): samples
  the least-recently-used keys and evicts whichever of those was read
  the fewest times. A bounded-window frequency heuristic (the same
  family of idea as W-TinyLFU's window admission), computed with plain
  arithmetic over counters that live on each cache entry. No training,
  no model weights, no offline fitting step.
- **`GET /predict/:key`** (`AccessPredictor`): a bigram frequency table
  over the live GET stream. Also plain counting, no training step. See
  [docs/api.md#get-predictkey](api.md#get-predictkey) for its documented
  limitation (no client/session concept, so the signal is real for one
  logical traffic source and degrades under many independent
  concurrent ones).

Neither is a neural network, a decision tree, or anything fit offline
against training data. If a future contributor wants to build the
actual "adaptive intelligence layer" the original pitch describes, this
is the honest starting line, not a finished first draft of it.

## Known limitations (not roadmap items — actual current constraints)

- **No automatic replica promotion.** If a primary dies, its replicas
  stay read-only replicas forever (rejecting client writes with 409)
  until an operator manually reconfigures one as the new primary
  (`INKCACHE_ROLE=primary`, update every other node's
  `INKCACHE_PRIMARY_URL`/`INKCACHE_REPLICA_URLS`, restart). Replication
  gives you a live, low-lag copy of the data; it does not give you
  automatic failover for the primary itself.
- **The cluster gateway is a single point of failure.** There's no
  gateway-to-gateway replication or failover — one gateway process
  routes for the whole cluster. Running two gateways behind a load
  balancer would work (they're stateless and derive their view of the
  cluster from the same node set), but that setup isn't built or
  tested here.
- **Node discovery requires each node to know its gateway's address up
  front.** `INKCACHE_GATEWAY_URL` is set at node startup; there's no
  service-discovery layer (DNS-SD, Consul, etc.) a node could use to
  find a gateway it doesn't already have the address of.
- **No authentication anywhere.** Every route on every process type is
  unauthenticated — documented, deliberate, and explained in
  [docs/security-notes.md](security-notes.md); this is a local/demo
  system, not something to expose on the open internet as-is.

## Persistence format ("database schema")

InkCache isn't a database and has no schema in the traditional sense —
it's an in-memory key-value store where every value is an opaque
string. The one on-disk artifact is the optional persistence snapshot
(`INKCACHE_PERSIST_PATH`): a JSON file shaped exactly like `GET
/snapshot`'s response (`{ "keys": [{ "key", "value", "ttl" }, ...] }`),
written atomically (temp file + rename) so a process killed mid-write
never leaves a corrupt file. Full detail, including the `ttl: null` ↔
"never expires" convention used throughout the API, is in
[docs/api.md](api.md#post-flush) and `src/network/persistence.ts`.

## Testing

There's no separate "testing report" document distinct from what CI
already proves on every push — a static document restating pass/fail
counts would drift out of date immediately. The
[CI badge](../readme.md) at the top of the README reflects the current
state of `main` directly. As of this document: 245 tests across 43
suites (`npm test`), covering pure unit logic (hash ring distribution,
eviction correctness, TTL expiry, access-predictor ranking), REST API
behavior against the real Express app (`supertest`), and multiple real
end-to-end scenarios that spawn actual child processes and drive them
over live HTTP rather than mocking the network boundary — replication
between two real nodes, a 3-node cluster gateway under real load,
killing and reviving a real node to verify failover, and a node
self-registering into a running gateway. See
[CONTRIBUTING.md](../CONTRIBUTING.md) for how to run the suite locally.
