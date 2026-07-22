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
- JSON error responses for malformed bodies and unknown routes instead
  of Express's default HTML pages; graceful shutdown on SIGINT/SIGTERM;
  request body size cap and basic security headers.

### Dashboard

- Went through three visual directions before settling: a CRT/phosphor
  terminal theme, then dark neumorphism, then the current light
  neumorphic-glass theme with retro hardware details (corner rivets,
  7-segment uptime clock, keycap shortcut legend, ticket-perforation
  dividers, punch-card/dot-matrix op stream).
- Keyboard-driven KV console (`set`/`get`/`del`/`flush`, arrow-key
  history, `/` to focus, Esc to clear) with a pressable send button and
  copy-last-value.
- Metrics: circular hit-rate gauge, hand-built analog needle gauge for
  ops/s, real ops/s + hit-rate + p95-latency sparklines fed by an
  actual rolling sample history (no synthesized data).
- KEYS panel rendered as an access-frequency heat map, colored by real
  hit counts from `/keys/stats`.
- Optional synthesized sound cues per event kind via Web Audio (off by
  default, `m` to toggle), synthetic traffic simulator, power-on boot
  sequence, `prefers-reduced-motion` support throughout.

### Home page & routing

- Dashboard is now two routes via react-router-dom: `/` (a new home
  page) and `/dashboard` (the console, unchanged behavior).
- Home page hero is a real Three.js scene (`@react-three/fiber` +
  `drei`): a ring of glass cache-slot cubes orbiting a pulsing core,
  driven live by real hit-rate (glow) and ops/s (rotation speed) —
  not a static render. Lazy-loaded and code-split so `/dashboard`
  never downloads three.js; falls back to a static panel if WebGL is
  unavailable or the scene throws at runtime; respects
  `prefers-reduced-motion`.
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
