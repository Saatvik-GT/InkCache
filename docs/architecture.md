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

This isn't a full distributed consensus system, but it isn't pure
fixed-pointer configuration either, not anymore: replicas run a real
Raft-style leader election (`src/core/election.ts` — terms, majority
votes, at most one winner per term, no replicated log) to pick a new
primary safely, and gateways gossip their known-node lists with their
peers (`src/network/gateway-sync.ts`). What's still fixed and
explicitly configured rather than discovered: a node's primary
(`INKCACHE_PRIMARY_URL`), a replica's election peers
(`INKCACHE_PEER_URLS`), and every process's gateway addresses
(`INKCACHE_GATEWAY_URL`/`INKCACHE_PEER_GATEWAYS`) — nothing finds any
of those on its own via service discovery. See
[Known limitations](#known-limitations-not-roadmap-items--actual-current-constraints)
below for exactly where the real boundary sits.

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

- **Automatic replica promotion is now safe for any number of
  replicas**, not just one. A replica campaigns for a real majority
  vote from `INKCACHE_PEER_URLS` (its siblings) before self-promoting
  (`src/core/election.ts` + `election-client.ts`) — a Raft-style
  term/vote mechanism, not a full Raft implementation (no replicated
  log through this path; data replication is the existing separate
  push model). The safety argument: any two majorities of the same
  fixed peer set must share at least one voter, and that voter can only
  grant one candidate a "yes" per term, so two replicas can never both
  win the same election. Verified with a real 3-replica end-to-end
  test: kill an actual shared primary, confirm exactly one of three
  real replica processes wins and the other two correctly adopt it,
  neither accepting a direct write. What's still real and out of
  scope: no election-state persistence across a restart (safe, since a
  restarted node just adopts whatever higher term it next observes,
  but starts back at term 0), no adaptive/backoff retry timing, and
  this is tuned for the seconds-scale failure-detection cadence it
  runs at, not a high-churn or much larger cluster. See
  [docs/api.md#automatic-primary-promotion](api.md#automatic-primary-promotion).
- **Running and coordinating multiple gateways is now supported.**
  `INKCACHE_GATEWAY_URL` accepts a comma-separated list, so a node can
  register with several gateways at once; `INKCACHE_PEER_GATEWAYS` lets
  gateways gossip their known-node lists with each other
  (`src/network/gateway-sync.ts`) so a node registered with only _one_
  gateway still becomes routable through its peers within one sync
  interval. Verified with real tests: two independent gateway
  processes, a node registering with both directly (multi-registration)
  and, separately, a node that only ever talked to one gateway becoming
  reachable through its peer purely via gossip, with real traffic
  actually routed through the gateway that never saw a direct
  registration. What's still real and out of scope: gateways don't
  discover _each other_ (each one's peer list is fixed at its own
  startup, same as a node's gateway list — no service-discovery layer
  like DNS-SD or Consul), and there's no shared state or leader between
  gateways, so two can briefly disagree about a node's _health_ (not
  its existence) if their independent checks land at different moments
  — gossip converges the known-node set, not a synchronized health
  snapshot.
- **Authentication is opt-in, not on by default.** `INKCACHE_API_KEY`
  (one shared secret across the whole cluster) and `INKCACHE_RATE_LIMIT`
  gate every route except `GET /health` when set — see
  [docs/api.md#authentication--rate-limiting](api.md#authentication--rate-limiting).
  Unset (the default), a node or gateway behaves exactly as it did
  before either feature existed. There's no per-client key, no
  expiry/rotation, no scopes — a real gap for anything beyond "one
  trusted operator controls every process in the cluster," which is
  this project's actual scope. Rate limiting is per-process and
  in-memory, not shared across a cluster's nodes. **The dashboard is
  not wired to send an API key** — enabling `INKCACHE_API_KEY` breaks
  it against that node until it's updated.

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
