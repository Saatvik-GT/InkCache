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
- Metrics rendered in block glyphs rather than SVG: a full-width hit-rate
  meter plus `▁▂▃▄▅▆▇█` sparklines for ops/s, hit rate and p95 latency,
  fed by an actual rolling sample history (no synthesized data). Null
  samples stay visible gaps rather than being interpolated across.
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
- Live stats strip, feature cards, a copyable quick-start curl
  snippet, and an honest architecture note (what's real today vs.
  roadmap) round out the home page.

### Deployment

- `Dockerfile` + `docker-compose.yml` for the cache node, runs as the
  unprivileged `node` user rather than root.
- `VITE_API_BASE` (dashboard) and `INKCACHE_CORS_ORIGIN` (node) so the
  dashboard can be deployed statically (e.g. Vercel, `vercel.json`
  included) while pointed at a node running elsewhere.

### Testing & CI

- `node:test` + supertest covering the cache core and every API route.
- GitHub Actions workflow running backend typecheck, `prettier --check`,
  tests, the dashboard's `oxlint`, the dashboard build, and a Docker
  build-and-run smoke test on every push/PR.
