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
  or strict `lru` as an explicit opt-out.
- `detailedKeys()` for per-key hit-count/TTL introspection (backs the
  dashboard's heat map).

### REST API

- `/set`, `/get/:key`, `/delete/:key`, `/keys`, `/keys/stats`,
  `/flush`, `/metrics`, `/health`, `/version`.
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

### Testing & CI

- `node:test` + supertest covering the cache core and every API route,
  plus the dashboard's pure-function lib code (ASCII rendering, plotting,
  the log store, fetch-error formatting, the traffic simulator's
  power-law key skew) — the same test runner reaching into
  `src/dashboard/src/lib` rather than a separate frontend test setup.
  Pure functions with a real dependency on `lib/api.ts` (which throws at
  module load outside Vite) get split into their own dependency-free
  file rather than left untestable — `lib/errors.ts` and
  `lib/skewedKey.ts` both exist for exactly that reason.
- GitHub Actions workflow running backend typecheck, `prettier --check`,
  tests, the dashboard's `oxlint`, the dashboard build, and a Docker
  build-and-run smoke test on every push/PR. A `concurrency` group
  cancels a still-running CI run when a newer push supersedes it, the
  job is capped at 15 minutes instead of GitHub's 360-minute default,
  `npm ci` caching covers the dashboard's own (much larger) lockfile as
  well as the root's, and the Docker build itself is cached across runs
  via `docker/build-push-action` + the GHA cache backend rather than
  rebuilding every layer from scratch on every push.

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

### Security

- `react-router-dom` stays on the 7.18.x line rather than following
  `npm audit fix --force` onto 7.11.0, which carries ten-plus advisories
  including an unauthenticated RCE — worse than the single advisory it
  would have "fixed." Rationale, the grep used to confirm the flagged
  advisory's code path is unreachable here, and what would invalidate
  the exemption are in `docs/security-notes.md`.
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
