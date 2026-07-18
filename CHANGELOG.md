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

### Testing & CI
- `node:test` + supertest covering the cache core and every API route.
- GitHub Actions workflow running typecheck, tests, and the dashboard
  build on every push/PR.
