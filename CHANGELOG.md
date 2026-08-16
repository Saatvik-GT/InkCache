# Changelog

All notable changes to this project are summarized here by feature area
rather than by date — the git log is the source of truth for exact
history. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] — Unreleased

### Core cache engine

- In-memory `CacheStore`: get/set/delete, TTL with lazy expiry and a
  background sweep.
- Configurable eviction: `access-aware` (default) samples the
  least-recently-used keys and evicts whichever was read the fewest
  times — a bounded-window frequency heuristic, not a trained model —
  strict `lru` as an explicit opt-out, or strict `lfu`
  (`INKCACHE_EVICTION_POLICY=lfu`) which scans every live entry for the
  true global-coldest key instead of a recency-bounded window. Closes
  the "LFU-as-a-standalone-policy" item the roadmap had flagged as
  pending since early on.
- `detailedKeys()` for per-key hit-count/TTL introspection (backs the
  dashboard's heat map).

### REST API

- `/set`, `/get/:key`, `/delete/:key`, `/invalidate`, `/keys`,
  `/keys/stats`, `/snapshot`, `/restore`, `/flush`, `/metrics`,
  `/metrics/history`, `/health`, `/version`.
- `GET /snapshot` + `POST /restore`: dump every live key's value and
  remaining TTL, and load one back (`CacheStore.exportEntries()`, a
  deliberately non-mutating read-only pass -- unlike `detailedKeys()` +
  `get()` per key, which would perturb hit counts and recency order as
  a side effect of exporting). `/restore` validates every entry before
  loading any of them (all-or-nothing, via a `validateEntry()` helper
  extracted from `/set` so both endpoints share identical rules).
  Caught and fixed a real bug via live end-to-end testing rather than
  unit tests alone: `/snapshot` reports a no-expiry key as `ttl: null`
  (matching `/get` and `/keys/stats`' own convention), but the
  extracted validator only treated `ttl: undefined` as "no ttl" --
  restoring an exported permanent key was rejected outright.
- Optional disk persistence (`INKCACHE_PERSIST_PATH`,
  `INKCACHE_PERSIST_INTERVAL`, both unset/disabled by default): a new
  `src/network/persistence.ts` (deliberately not in `src/core` --
  `cache.ts`'s own header documents it as dependency-free, and file I/O
  doesn't belong there) loads a snapshot on startup, auto-saves on an
  interval, and does one best-effort final save on graceful shutdown.
  Writes are atomic (temp file + rename); a missing or corrupt file
  just starts the node empty with a warning rather than crashing --
  same discipline the rest of this layer already applies to garbage
  env-var input. Live-verified the startup-load and periodic-save
  paths against a real running node. The graceful-shutdown final-save
  path needed a real delivered `SIGTERM` to verify and couldn't be
  tested from Windows at all -- `Stop-Process` and `taskkill` both
  terminate the process unconditionally rather than deliver a
  catchable signal, even to a plain (non-containerized) `node`
  process. Verified for real against the actual Docker image instead:
  `docker stop` (graceful, real `SIGTERM` on a real POSIX target)
  against a running container correctly triggered the shutdown log
  line and left the seeded key in the persisted file. That check is
  now permanent, not just a one-off local run -- see the CI entry
  below.
- `POST /invalidate`: bulk-delete every key starting with a given
  prefix (`CacheStore.deleteByPrefix()`), for invalidating a whole
  group of related keys (e.g. `user:42:*`) without knowing the exact
  key set in advance. Same "empty string matches everything, still not
  an error" semantics as `/flush`. Wired into the KV console too
  (`invalidate <prefix>`).
- `GET /metrics/history`: a rolling 1-hour, 360-entry in-memory window
  of periodic `/metrics` snapshots (`MetricsCollector.startHistory()`,
  same unref'd-interval/restart-safe pattern as `CacheStore`'s
  sweeper), so hit-rate/evictions/latency trend over time is visible
  instead of only ever showing the current instant. Not persisted to
  disk — resets on restart.
- Per-op latency instrumentation (avg/p95), hit-rate, rolling
  throughput, eviction-policy reporting.
- JSON error responses for every error case (malformed body, oversized
  body, unknown route, and now a catch-all for anything else
  unexpected) instead of Express's default HTML error page — the
  oversized-body and catch-all cases were a real gap found and fixed
  live, since neither previously existed and both leaked a stack trace
  with server filesystem paths. Graceful shutdown on SIGINT/SIGTERM
  (now with a 5s force-exit safety net against a hung connection);
  request body size cap and basic security headers.
- All numeric config env vars (`INKCACHE_PORT`, `INKCACHE_MAX_ENTRIES`,
  `INKCACHE_EVICTION_SAMPLE`) are validated as positive integers and
  fall back to their default with a warning on garbage input — fixes a
  real bug where an unvalidated `Number("garbage")` (`NaN`) silently
  disabled eviction entirely (`size >= NaN` is always `false`).

### Replication

- Single-primary, best-effort replication (roadmap Sprint 3):
  `INKCACHE_ROLE=replica` + `INKCACHE_PRIMARY_URL` turns a node into a
  read-only replica of another node. A primary forwards every
  `/set`/`/delete`/`/invalidate`/`/flush` to each URL in
  `INKCACHE_REPLICA_URLS` (fire-and-forget, over HTTP, via a new
  internal `POST /internal/replicate` endpoint) without blocking its
  own response on any replica being reachable. A replica pulls a full
  `GET /snapshot` from its primary once at startup (bounded retries, in
  case the primary isn't up yet) before it starts listening, then
  applies replicated ops as they arrive. A replica rejects direct
  client writes with **409**, so its state can only change via
  replication -- it can't silently drift from its primary.
  `POST /restore` is deliberately not forwarded (bulk/local-dev only,
  not live traffic). `/health` and `/metrics` both report `role`, and a
  primary reports `replicaCount` where a replica reports `primaryUrl`.
  See [docs/api.md#replication](docs/api.md#replication).
- Verified with a real end-to-end test that spawns two actual server
  processes (a primary and a replica pointed at it) and drives them
  over real HTTP -- not mocked -- covering the startup snapshot pull,
  live op forwarding for set/delete, the replica's write rejection, and
  both nodes' reported `role`.

### Sharding & cluster gateway

- Consistent hashing ring (roadmap Sprint 4, part 1): `src/core/hashring.ts`'s
  `HashRing` maps a key to one of a set of node ids via MD5 into a
  sorted ring (150 virtual points per node by default), so adding or
  removing a node only remaps the keys that were on that node instead
  of reshuffling the whole keyspace the way `hash(key) % nodeCount`
  would. Pure data structure, no I/O -- tested for the properties that
  matter (even distribution within a real bound, and every remapped key
  on add/remove traced back to the node that actually changed).
- Cluster router (part 2): `src/network/cluster.ts`'s `ClusterRouter`
  wraps `HashRing` so callers work in terms of real InkCache node base
  URLs (`nodeFor(key)`, `addNode`/`removeNode`) instead of ring node-ids.
- Cluster gateway (part 3): a new standalone process
  (`npm run start:gateway` / `dev:gateway`, `src/network/gateway.ts` +
  `gateway-server.ts`) that proxies `/set`, `/get/:key`, `/delete/:key`
  to whichever node `INKCACHE_CLUSTER_NODES` says owns the key, plus
  `/cluster/nodes` and `/cluster/route/:key` for introspection. Holds no
  cache state of its own -- pure routing, relaying the target node's
  response back verbatim, **502** if that node is unreachable and
  **503** if no nodes are configured at all. See
  [docs/api.md#cluster-gateway](docs/api.md#cluster-gateway).
- Verified with a real end-to-end test that spawns three actual cache
  node processes plus a real gateway process pointed at all three:
  writes and reads routed correctly, load genuinely spread across every
  node (not just node 1), and each key's actual location cross-checked
  against a `ClusterRouter` built independently in the test process
  (proving the hashing is deterministic across process boundaries, not
  just within one). Also manually verified live against three real
  running nodes with curl.
- Failure handling (part 4): `src/network/health-check.ts`'s
  `startHealthChecks()` actively polls every configured node's
  `/health` on `INKCACHE_GATEWAY_HEALTH_INTERVAL` (default 2s, 1s
  per-check timeout via `AbortController`) and keeps the gateway's
  `ClusterRouter` in sync -- a node that fails a check is pulled out of
  the hashing ring immediately (so new requests reroute to the next
  node instead of 502ing against a dead one), and put back the moment
  it answers again. Deliberately simple and not flap-damped: one failed
  check removes a node, one successful check restores it, no
  failure-count threshold. `GET /cluster/nodes` now reports every
  configured node's live health, not just the currently-routable set.
- Verified with a real test that spawns two actual node processes plus
  a gateway, kills one node outright, confirms the gateway detects it
  (`/cluster/nodes` reports it unhealthy) and reroutes a write that
  used to hash to it onto the survivor, then restarts the killed node
  on the same port and confirms the gateway notices it's back. Also 5
  unit tests against a toggleable local HTTP server covering the
  up/down/up cycle, `stop()` actually halting further checks, and the
  "every node starts assumed healthy" initial state.
- Node discovery (roadmap Sprint 4's final piece): `INKCACHE_CLUSTER_NODES`
  is now only the gateway's _initial_ set, not a ceiling. `POST
/cluster/nodes` (`{ "url": "..." }`) registers a node at runtime --
  **409** if already registered, **400** on a missing/non-string
  `url` -- adding it to both the hashing ring and the health checker
  immediately; `DELETE /cluster/nodes` deregisters one (a no-op if
  unknown, same tolerance `/delete/:key` already has). `health-check.ts`'s
  handle grew `addNode()`/`removeNode()` so the checker's monitored set
  is mutable, not fixed at construction. `gateway-server.ts` now always
  starts health checking, even with zero initial nodes, so there's a
  live handle for a first node to register against.
- `server.ts` can self-register with a gateway instead of an operator
  curling it by hand: `INKCACHE_GATEWAY_URL` + `INKCACHE_SELF_URL`
  (the node's own externally-reachable base URL -- deliberately not
  inferred from `INKCACHE_PORT`, which would be wrong the instant the
  node and gateway aren't on the same host) register the node on
  startup and deregister it on a graceful shutdown, best-effort.
- Verified with a real test that starts a gateway with **zero**
  configured nodes, starts a node with self-registration env vars set,
  confirms the gateway picks it up and can actually route real traffic
  to it, then sends it a real HTTP DELETE to deregister. The
  SIGTERM-triggered half of deregistration hits the same
  Windows-can't-deliver-a-real-signal limitation already documented for
  the Docker graceful-shutdown smoke test (confirmed again here by
  direct reproduction: a SIGTERM to a plain node on this dev machine
  kills it without its own "received SIGTERM" log line ever printing)
  -- that specific assertion is skipped on `win32` and holds on a real
  POSIX target (CI), same as the Docker case. Also fixed a real bug
  caught by this work: `GET /cluster/nodes`'s fallback path (no health
  checker running) was reading the static `INKCACHE_CLUSTER_NODES`
  env-var snapshot instead of the router's live node list, so a
  dynamically-registered node silently didn't show up in that response
  shape.

### Predictive access-pattern hints

- Roadmap Sprint 5's remaining item: `src/core/access-predictor.ts`'s
  `AccessPredictor` learns a bigram frequency table over the live GET
  stream ("of everything that's ever immediately followed key A, which
  came up most often") and `GET /predict/:key` exposes it. Every `GET
/get/:key` (hit or miss) feeds it. Deliberately framed as a
  **statistical heuristic, not a trained/learned model** -- no neural
  net, no training step -- same honesty this project already applies to
  access-aware eviction. InkCache has no upstream store to prefetch
  data _into_ (it _is_ the store), so this is a hint for a **client**
  to proactively `GET` a key it's likely to need next, not something
  InkCache fetches on its own. Bounded memory: at most 2000 distinct
  "from" keys tracked (oldest evicted first), at most 20 candidates per
  "from" key (least-observed evicted first). `?top=N` on the query
  string controls how many predictions come back (default 3, capped at
  20); always **200**, even for a never-seen key -- an empty
  `predictions` array is a valid answer, not an error.
- Documented limitation, stated plainly rather than glossed over: the
  API has no client/session concept, so transitions are counted across
  the _entire_ GET stream, not per caller -- real signal for a single
  logical traffic source, degrading toward noise under many truly
  independent concurrent clients. A property of the API's lack of a
  session concept, not a bug in the counting.
- Unit-tested the actual interesting behavior, not just happy-path
  smoke: ranking by frequency, probability as a real share of observed
  transitions, `topN`, no self-transition recorded, and both eviction
  policies (oldest "from" key, least-observed candidate) verified
  against the _real_ sequential chain `record()` produces -- caught and
  fixed a wrong assumption in the first draft of the eviction test
  about which transitions actually get recorded from an interleaved
  key sequence. Also API-tested against the real Express app (learns
  from real HTTP traffic, records misses too, `?top=` handling) and
  live-verified against an actual running node with curl.

### Final documentation & demo prep

- Roadmap Sprint 7's remaining pieces, now that the distributed layer
  they were explicitly gated on actually exists: new
  `docs/architecture.md` (a real process/component diagram matching
  what's actually built -- not the root README's original aspirational
  pitch diagram, which stays clearly marked as aspirational rather than
  being overwritten as if it were now real; data flow for a `GET` and a
  write through the gateway/replication path; an explicit
  heuristic-vs-machine-learning line for the two statistical features;
  a "known limitations" section stating plainly what's _not_ handled
  yet -- no automatic replica promotion, the gateway is a single point
  of failure, node discovery needs a known gateway address up front, no
  auth anywhere) and `docs/demo-script.md` (a runnable, section-by-
  section walkthrough of every real feature, with expected output for
  each step -- the eviction-policy section was spot-verified live
  against a real running node while writing this, rather than written
  speculatively).
- No separate database-schema doc or testing-report doc: InkCache isn't
  a database (its only on-disk artifact, the persistence snapshot, is
  documented inline in `docs/architecture.md` instead), and a static
  testing-report document would drift out of date immediately -- the
  README's CI badge and `docs/architecture.md`'s live test count serve
  that purpose instead. Stated directly in the README rather than left
  as a silently-dropped roadmap item.

### Authentication & rate limiting

- Opt-in shared-secret auth (`INKCACHE_API_KEY`, unset/disabled by
  default): one secret across the whole cluster, checked via
  `X-API-Key` or `Authorization: Bearer` with a constant-time
  comparison (`node:crypto`'s `timingSafeEqual`, not `===`, so response
  timing doesn't leak how much of a guessed key matched). `GET /health`
  stays open regardless -- a liveness probe isn't a data-access
  boundary. New `src/network/auth.ts`, a factory
  (`createAuthMiddleware(apiKey)`) rather than a module-level singleton
  reading `process.env` itself, matching how `app.ts` already resolves
  its own env vars and passes values into pure helpers.
- Opt-in per-process, in-memory, fixed-window rate limiting
  (`INKCACHE_RATE_LIMIT` + `INKCACHE_RATE_LIMIT_WINDOW`, default 10s):
  new `src/network/rate-limit.ts`, keyed by client IP, bounded memory
  (oldest-tracked client evicted first, same simple strategy
  `access-predictor.ts` and `metrics.ts`'s ring buffer already use).
  **429** with a `Retry-After` header once exceeded; `/health` exempt
  for the same liveness-probe reason as auth. Registered _before_ auth
  in the middleware chain on purpose -- an unauthenticated client
  guessing keys should get throttled too, not just rejected.
- Every internal caller in the codebase attaches the shared key
  automatically once configured, so a cluster keeps working end-to-end
  rather than the feature only protecting the outermost hop:
  `forwardToReplicas()`/`syncFromPrimary()` in `replication.ts`, the
  gateway's own request proxying in `gateway.ts`, and a node's
  self-registration (`announceToGateway()`) in `server.ts`. This
  required passing an optional `apiKey` parameter through
  `forwardToReplicas()`/`syncFromPrimary()`'s signatures (backward
  compatible -- existing callers that omit it are unaffected, since an
  absent key means `authHeader()` contributes no header at all).
- Verified with a real end-to-end test suite (4 tests) spawning actual
  node/replica/gateway processes with `INKCACHE_API_KEY`/
  `INKCACHE_RATE_LIMIT` set: unauthenticated and wrong-key requests
  rejected, both accepted header forms work, a replicated write
  actually lands on the replica (proving the forwarded auth header
  works, not just the primary's own check), the gateway both enforces
  its own auth _and_ correctly re-authenticates itself to the node it
  proxies to, and real HTTP 429s once the configured limit is
  exceeded. Plus 17 unit tests (`auth.test.ts`, `rate-limit.test.ts`)
  covering both header forms, wrong-length keys, non-Bearer schemes,
  per-client independence, and bounded-memory eviction for the rate
  limiter via direct middleware calls (supertest can't fabricate
  distinct client IPs).
- Documented, real limitations, not silently left implicit: one shared
  secret for the whole cluster, not per-client keys -- no expiry,
  rotation, or scopes. Rate limiting is per-process, not shared across
  a cluster's nodes. **The dashboard is not wired to send an API key**
  -- enabling `INKCACHE_API_KEY` breaks it against that node until it's
  updated to attach one.

### Multi-gateway node discovery (closing the gateway-SPOF gap)

- `INKCACHE_GATEWAY_URL` now accepts one or more comma-separated
  gateway base URLs (parsed with the same trim/no-trailing-slash/
  drop-blanks logic `replication.ts`'s `resolveReplicaUrls()` already
  had, reused under a clearer local name rather than duplicated a
  third time). `server.ts`'s `announceToGateway()` registers with (and
  deregisters from) every listed gateway independently and
  best-effort -- one being unreachable doesn't stop registration with
  the others.
- This is what actually closes `docs/architecture.md`'s "the cluster
  gateway is a single point of failure" limitation: every gateway
  process was already fully stateless (its whole view of the cluster
  comes from health checks + registrations, nothing shared between
  gateway processes), so the missing piece for running two behind a
  failover/load balancer was just getting every node to tell _both_
  about itself -- which this does. Updated the doc to be precise about
  what's still missing: no coordination _between_ gateways (no shared
  state, no leader), and no way for a gateway to discover _other_
  gateways to fan a registration out to on its own.
- Verified with a real end-to-end test: two independent gateway
  processes (neither aware the other exists) with zero initial nodes,
  one node registering with both via a comma-separated
  `INKCACHE_GATEWAY_URL`, confirming both gateways' `/cluster/nodes`
  list it and that real traffic routes correctly through _either_
  gateway to the same node.
- Caught and fixed a real, pre-existing flaky test while verifying this
  under the full suite (not something this change introduced, but
  found while running it repeatedly): `tests/replication.test.ts`'s
  `forwardToReplicas()` tests shared one HTTP capture server across the
  whole describe block via `before()`/`after()`, with a fixed 100ms
  sleep to let a fire-and-forget request land. Under load, a slow
  request from one test could still be in flight past that test's own
  wait and land during a _later_ test's window on the same shared
  server, corrupting its count regardless of how that later test
  waited for its own requests. Fixed by giving each test its own
  server (structurally impossible for a straggler to cross tests once
  the port it targets is different) and replacing the fixed sleep with
  a poll-until-count-reached helper. Confirmed fixed with 3 consecutive
  clean full-suite runs after the change, where it had reproduced
  within the first run before.

### Dashboard

- Went through four visual directions before settling: a CRT/phosphor
  terminal theme, dark neumorphism, light neumorphic-glass with retro
  hardware details, and finally the current **ASCII terminal** — black
  field, box-drawing panel chrome, and a five-step greyscale ramp that
  serves as both the UI hierarchy and the ASCII luminance scale.
- Keyboard-driven KV console (`set`/`get`/`del`/`flush`, arrow-key
  history, `/` to focus, Esc to clear) with a pressable send button and
  copy-last-value.
- Rebuilt from a sparkline-based metrics panel into a dense tiled
  ops-console grid: hits-vs-misses and latency (avg/p95) plotted as line
  charts on the character grid (own small plotting library — connected
  traces, not scattered points, with nulls breaking the line rather than
  being bridged), a node-counters table, a hottest-keys bar chart, and a
  dedicated store-capacity gauge, fed by an actual rolling sample history
  (no synthesized data).
- KEYS panel is an access-frequency heat map using shade glyphs
  (`░▒▓█`) sorted hottest-first, driven by real hit counts from
  `/keys/stats` — density rides on the glyph rather than a background
  tint, so the ranking survives monochrome and screenshots.
- Optional synthesized sound cues per event kind via Web Audio (off by
  default, `m` to toggle), synthetic traffic simulator, power-on boot
  sequence, `prefers-reduced-motion` support throughout.

### Home page & routing

- Dashboard is now two routes via react-router-dom: `/` (a new home
  page) and `/dashboard` (the console, unchanged behavior).
- Home page hero is a **rotating ASCII moon** — a genuine 3D sphere
  (spherical sampling, per-cell depth buffer, diffuse lighting against a
  fixed world-space light, limb darkening, object-space crater field)
  rasterized to characters instead of pixels. Rotation speed is derived
  from live ops/sec; `prefers-reduced-motion` holds a static lit frame
  rather than merely slowing it.
- Headlines use a hand-built 5×7 bitmap font rendered into the same
  character grid, so display type scales by font-size instead of by
  resampling an image.
- This replaced an earlier Three.js hero (`@react-three/fiber` + `drei`).
  Removing it took `three`, `@react-three/*` and `@types/three` out of
  the tree along with the lazy-loading, WebGL capability probe, 3D error
  boundary and static fallback that existed solely to manage three's
  weight and hardware requirement — shipped JS went from ~1.16 MB
  (271 KB main + an 899 KB lazy chunk) to a single ~267 KB bundle.
- Simplified to a single-screen hero: the moon, a live node-stats strip
  as a dot-leader manifest, and a link into the console, in front of a
  deterministic ASCII starfield — the feature cards, quick-start
  snippet and roadmap checklist that used to fill out the rest of the
  page were cut.

### Deployment

- `Dockerfile` + `docker-compose.yml` for the cache node, runs as the
  unprivileged `node` user rather than root.
- `VITE_API_BASE` (dashboard) and `INKCACHE_CORS_ORIGIN` (node) so the
  dashboard can be deployed statically (e.g. Vercel, `vercel.json`
  included) while pointed at a node running elsewhere.
- `docs/index.html`: a standalone, no-build ASCII-themed marketing page
  for GitHub Pages (`Settings → Pages → Deploy from branch main, folder
/docs`) — distinct from the live `/dashboard` console, this is a
  static pitch page with its own hand-ported copy of the design tokens
  and 5×7 bitmap headline font, a full-bleed looping background gif, a
  glitch effect on the headline, and a locked single-viewport layout
  (no scrollbar) sized against `min(vw, vh)`. Its nav points at
  [Getting Started](#getting-started) rather than the repo root — a
  visitor deciding whether to try this locally wants the install
  steps, not another way to land on the page they're already on.
  Own favicon (amber, matching the page's own accent rather than the
  dashboard's teal) and `theme-color`, since neither existed before.
  Open Graph/Twitter card tags so the URL doesn't unfurl blank when
  shared — deliberately no `og:image`/`twitter:image`: the background
  gif is 37MB, several times over every major platform's preview-image
  limit (Twitter/X and LinkedIn ~5MB, Facebook ~8MB), and a broken
  image reference in a social preview is worse than none. The
  background `<img>` also fails gracefully (`onerror` hides it) rather
  than showing a broken-image icon if the gif is ever missing, e.g. on
  a fork that doesn't carry the large file.

### Testing & CI

- `node:test` + supertest covering the cache core and every API route,
  plus the dashboard's pure-function lib code (ASCII rendering, plotting,
  the log store, fetch-error formatting, the traffic simulator's
  power-law key skew) — the same test runner reaching into
  `src/dashboard/src/lib` rather than a separate frontend test setup.
  Pure functions with a real dependency on `lib/api.ts` (which throws at
  module load outside Vite) get split into their own dependency-free
  file rather than left untestable — `lib/errors.ts` and
  `lib/skewedKey.ts` both exist for exactly that reason. Backend config
  validation follows the same instinct: `resolveEvictionPolicy()` was
  pulled out of `app.ts`'s inline validate-and-warn block into `env.ts`
  as a pure function (same reason `resolveCorsOrigins` exists), directly
  unit-testable without spinning up the whole Express app.
- GitHub Actions workflow running backend typecheck, `prettier --check`,
  tests, the dashboard's `oxlint`, the dashboard build, and a Docker
  build-and-run smoke test on every push/PR. A `concurrency` group
  cancels a still-running CI run when a newer push supersedes it, the
  job is capped at 15 minutes instead of GitHub's 360-minute default,
  `npm ci` caching covers the dashboard's own (much larger) lockfile as
  well as the root's, and the Docker build itself is cached across runs
  via `docker/build-push-action` + the GHA cache backend rather than
  rebuilding every layer from scratch on every push. The smoke test now
  also seeds a key, sends a real `docker stop` (graceful `SIGTERM`,
  not the `docker rm -f` it used to go straight to), and checks both
  that the shutdown log line appears and that the persistence final-
  save (`INKCACHE_PERSIST_PATH`) actually wrote the seeded key to disk
  before the container exits -- this is also the check that confirms
  `CMD`'s `npx tsx ...` (`npx` is PID 1 in the container) genuinely
  forwards the signal to the real `node` process instead of
  swallowing it, which a plain `docker rm -f` never exercised.
- Fixed a real ordering bug: "Typecheck backend" ran before "Install
  dashboard deps", but the root tsconfig's `tests/**/*` transitively
  type-checks dashboard lib code (`tests/log.test.ts` → `lib/log.ts` →
  `lib/sound.ts`, which needs `@types/react` for
  `useSyncExternalStore`'s signature) — `@types/react` only exists once
  the dashboard's own `npm ci` has run. Every CI run failed with
  "Cannot find module 'react'" on a clean checkout until the dashboard
  install step was moved ahead of both the typecheck and test steps.
  Local `npm ci` runs never caught this because dashboard's
  `node_modules` was already on disk from earlier work.
- `npm run benchmark` (`scripts/benchmark.ts`): spins up a real, separate
  node per eviction policy (`lru`/`access-aware`/`lfu`), seeds an 800-key
  skewed population against a deliberately undersized 200-entry cache to
  force real eviction pressure, runs a mixed 85%-read/15%-write HTTP load
  with `autocannon` for 8s per policy, and reports hit rate + evictions
  from the node's own `/metrics` alongside autocannon's raw
  throughput/latency — hit rate under memory pressure is the interesting
  comparison, since all three policies run the same request-handling
  code path. Not a CI step; meant to be read, not just passed/failed.
  Closes the `npm run benchmark` promise the README had been carrying
  since before this tool existed.
- `npm run benchmark:external` (`scripts/benchmark-external.ts`): the
  same skewed-key, 85/15 read/write workload run against real
  `redis:7-alpine` and `memcached:1.6-alpine` containers (via `ioredis`
  and `memjs`, each backend's own native protocol -- not HTTP, since
  fronting them with a REST shim just to reuse `autocannon` would
  measure the shim, not them) alongside InkCache over real HTTP,
  closing the "benchmarking vs. Redis/Memcached" item the roadmap had
  listed as open since Sprint 6. A throughput/latency comparison, not
  an eviction-effectiveness one -- Redis's memory-based `maxmemory` and
  Memcached's slab-based `-m` don't evict the same way InkCache's
  entry-count-based `maxEntries` does, so both are configured with
  generous memory limits so no eviction happens during the run at all,
  documented in the file's own header. Separate script/command from
  `npm run benchmark` on purpose: this one needs Docker, and shouldn't
  make the simpler, dependency-free comparison unusable without it.
  Live-verified three times: real, varying (not fabricated) numbers
  each run, Redis fastest and InkCache slowest (HTTP+JSON overhead on
  top of the same underlying operations, against two binary-protocol
  backends), and confirmed zero leftover Docker containers or
  processes after every run.

### Accessibility

- Every decorative ASCII glyph that duplicates real text next to it
  (meters, heat-map glyphs, bar-chart bars, the raw line-chart trace) is
  now `aria-hidden`, with `sr-only` summaries added where the chart was
  the _only_ source of a number a screen reader user would otherwise
  never get.
- Fixed the home page shipping three separate `<h1>` elements (one per
  colour-styled word in "CACHE THAT ADAPTS") instead of one coherent
  heading, and the console page having no `<h1>` at all.
- Every panel (`AsciiPanel`, the base for all of them) is a `<section>`
  landmark that previously had no accessible name — landmark navigation
  would have listed every one of them identically as "region".
- `aria-live="polite"` on the two places connection status changes
  silently (home page, console) and on KV console command output.
- The toggle switch's accessible name was only wired to `title` (a
  tooltip) — a screen reader announced its literal bracket glyphs
  instead of what it does. Now has a real `aria-label`.

### Fixes

- A silent data-corruption bug in the KV console's command tokenizer: an
  unclosed quote (`set foo "bar`) dropped the real last character of the
  value instead of leaving it untouched.
- The dashboard's TypeScript configs never had `strict: true` — the
  backend enforced it, the dashboard quietly didn't. Enabling it
  surfaced zero new errors; the code was already strict-clean.
- `INKCACHE_NODE_ID`'s `"node-1"` default was independently duplicated
  in both `app.ts` and `server.ts` (the exact drift risk this file
  already documents for `MAX_ENTRIES`) — now defined once and imported.
- `MAX_KEY_LENGTH` was the one hardcoded config value left over once
  `MAX_ENTRIES`/`EVICTION_SAMPLE`/`EVICTION_POLICY` all became env vars;
  it's now `INKCACHE_MAX_KEY_LENGTH`, same validation as the rest.
- The traffic simulator runs on a module-level `setInterval` independent
  of any component's lifecycle — starting it on `/dashboard` and then
  navigating to `/` used to leave it firing real requests against the
  node in the background indefinitely, with no indication anywhere on
  the home page. Now stops on unmount.
- Neither the KV console's run button nor the flush button reflected
  their own in-flight state; both are disabled while their request is
  pending, matching the pattern the console's text input already used.
- The flush button's failure handler discarded the real error and always
  logged a generic "flush failed", while the KV console's own error
  handling for the identical failure mode (the node itself unreachable)
  already gave a specific, useful message. Both now share one
  `describeFetchError()` helper — moved to its own `lib/errors.ts` (no
  `import.meta.env` dependency) after discovering `api.ts` throws at
  module load outside Vite, which made the whole file untestable via
  plain `node:test` despite this being a pure function with no such need.
- The copy-last-value button could throw synchronously (before its own
  `.catch()` ever attached) if `navigator.clipboard` was unavailable —
  a non-secure context or an older browser — leaving the user with no
  feedback at all instead of the intended error message.
- `TopKeysChart` truncates long keys to their last 5 characters for the bar
  label, but `BarChart` used that same truncated label as the React `key`
  for its value/footer spans — two keys sharing a tail (e.g. two
  `sim:user:12345`-style entries) collided, so a re-render could reconcile
  the wrong bar's value onto the wrong label. Now keyed by array index,
  which is safe here since the whole bar list is replaced wholesale each
  poll rather than reordered in place.
- `StoreGauge`'s fill percentage and "N free" readout were unclamped: a
  burst of concurrent sets landing before the eviction sweep catches up
  could briefly push `keys` past `maxEntries`, rendering over 100% fill
  and a negative free count. Now clamped to [0, 100]% and free floored at 0.
- `INKCACHE_EVICTION_POLICY` silently accepted any typo as `access-aware`
  with no warning, unlike every numeric env var (which all warn via
  `parsePositiveInt`) — now warns and falls back the same way.
- Five dashboard `lib/`/`hooks/` files (`log.ts`, `sound.ts`,
  `simulator.ts`, `useKeyStats.ts`, `useNode.ts`) had relative imports
  missing the `.js` extension `NodeNext` module resolution requires.
  Vite's bundler resolution (the dashboard's own tsconfig) masked this
  completely — these built and ran fine through Vite, but would break
  running under plain Node ESM without a bundler. Surfaced by testing
  `log.ts` for the first time.

### Performance

- `MetricsCollector.record()` pruned its rolling throughput window with
  `Array.shift()` in a loop — O(n) per call because it re-indexes every
  remaining element — on every single cache operation (`record()` runs
  on the request hot path, not just on `/metrics` polls). Replaced with
  a head-index pointer plus periodic compaction, so pruning is amortized
  O(1) instead of scaling with request rate.
- `MetricsCollector.snapshot()` sorted the full latency sample buffer
  (up to 512 entries) on every `/metrics` read just to compute the
  average, which only needs an O(1) running sum — now tracked
  incrementally in `record()`, adjusted for whichever sample the ring
  buffer overwrites. The sort is kept for p95, which genuinely needs
  order statistics. `snapshot()` also re-scanned the whole timestamp
  array a second time to correct for staleness between throughput-window
  prunes; replaced with a binary search, since timestamps are pushed in
  increasing order.
- `CacheStore.keys()` did two Map lookups per key — one implicit in
  iterating `entries.keys()`, one explicit inside the `has()` call used
  to filter out expired keys. Rewritten as a single pass over
  `entries`' `[key, value]` pairs, checking expiry inline, matching the
  pattern `detailedKeys()`/`exportEntries()` already used.
- `Dockerfile` transpiled TypeScript through `tsx` on every container
  start; now a multi-stage build compiles once with `tsc`
  (`tsconfig.build.json`, `src/core` + `src/network` only) and the
  runtime stage runs the plain compiled JS with the bare `node` binary
  as PID 1. `tsx` moved back to `devDependencies` — it's no longer
  needed at runtime — and the runtime image no longer needs a
  TypeScript toolchain at all. Also removes the `npx` layer that used
  to sit between PID 1 and the actual `node` process, so there's one
  fewer thing that could swallow a shutdown signal instead of
  forwarding it (re-verified against a real `docker stop`: graceful
  shutdown and the final persistence save both still fire correctly).
- `GET /get/:key` — the single hottest endpoint — called `store.get(key)`
  then `store.ttl(key)` separately, a second Map lookup (plus a second
  expiry check re-doing work `get()` already did) for a key it already
  had the live entry for on every request. Added `CacheStore.getWithTtl()`,
  returning both in one pass; the route uses it instead of chaining the
  two standalone methods, which stay as-is for their other callers.
- Dashboard: `TopKeysChart` and `KeysPanel` each called `useKeyStats()`
  independently, even though both always render together on the
  Dashboard page with the identical `refreshToken` — every real change
  (set/delete/eviction) fired two identical `GET /keys/stats` requests
  instead of one. `useKeyStats()` is now called once in `Dashboard.tsx`
  and passed down as a `stats` prop to both. Verified against a live
  dev server with Playwright: exactly one request fires per real write,
  both panels still render the same live data as before.

### Security

- `react-router-dom` stays on the 7.18.x line rather than following
  `npm audit fix --force` onto 7.11.0, which carries ten-plus advisories
  including an unauthenticated RCE — worse than the single advisory it
  would have "fixed." Rationale, the grep used to confirm the flagged
  advisory's code path is unreachable here, and what would invalidate
  the exemption are in `docs/security-notes.md`.
- `autocannon` (a devDependency, added for `npm run benchmark`) pulls in
  a moderate `uuid` advisory transitively via `hyperid`. Verified by
  reading `hyperid`'s actual source that it calls `uuid.v4()` with no
  arguments — the advisory requires `v3`/`v5`/`v6` with an explicit `buf`
  argument, neither of which applies — rather than following
  `npm audit fix --force` onto `autocannon@2.0.1`, a five-major-version
  regression for a tool that's never installed in the production image.
  Same reasoning discipline as the `react-router-dom` exemption; details
  in `docs/security-notes.md`.
- Express's default `X-Powered-By: Express` header — announcing the
  stack to every client for no benefit — was being sent on every
  response and is now disabled, alongside the three headers already
  applied by hand above it.
- The three hand-applied security headers were silently missing from
  every CORS preflight (`OPTIONS`) response — `cors()` answers a
  preflight itself without calling `next()`, so the headers middleware
  (registered after it) never ran for that response. Caught by curling
  a real preflight and diffing its headers against a normal request.
  Fixed by reordering the middleware; regression-tested.
