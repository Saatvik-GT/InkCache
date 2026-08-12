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
