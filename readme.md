# InkCache — Toward an Intelligent, Distributed Caching System

> A key-value cache aiming to go beyond static eviction policies by learning access patterns to optimize hit rates and reduce latency, on its way to scaling horizontally across nodes. What's actually built and running today — a single-node core with access-aware eviction — is in [Current Status](#current-status) below.

[![CI](https://github.com/Saatvik-GT/InkCache/actions/workflows/ci.yml/badge.svg)](https://github.com/Saatvik-GT/InkCache/actions/workflows/ci.yml)
[![Status](https://img.shields.io/badge/status-in%20development-yellow)](#project-roadmap)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Program](https://img.shields.io/badge/CUSoC-2026-orange)](#overview)

---

## Table of Contents

- [Overview](#overview)
- [Problem Statement](#problem-statement)
- [Current Status](#current-status)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Roadmap](#project-roadmap)
- [Getting Started](#getting-started)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Testing](#testing)
- [Deployment](#deployment)
- [Project Structure](#project-structure)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Acknowledgements](#acknowledgements)
- [License](#license)

---

## Overview

InkCache is a distributed caching system built as part of the **Chandigarh University Season of Code (CUSoC)** program under subject code **24CSI-305 (Institute/Industrial Summer Training)**.

Traditional caching layers (Redis, Memcached) rely on static eviction policies — LRU, LFU, or fixed TTLs — that don't adapt to changing access patterns. InkCache aims to layer _intelligence_ on top of a solid distributed caching foundation: predicting hot keys, adapting eviction dynamically, and rebalancing load across nodes without manual tuning.

## Problem Statement

Modern applications serve highly skewed, time-varying access patterns (diurnal traffic, sudden hotspots, seasonal spikes) that static caching policies handle poorly — leading to unnecessary cache misses, wasted memory on cold keys, and uneven load across distributed nodes.

InkCache addresses this by combining:

1. A **correct, performant distributed cache core** (replication, consistent hashing, failure handling)
2. An **adaptive intelligence layer** that learns access patterns and adjusts eviction/prefetching decisions accordingly

## Current Status

**Implemented and working today (single-node demo):**

- In-memory cache core: get/set/delete, TTL with lazy expiry + background sweep, configurable eviction — `access-aware` (default: samples the least-recently-used keys and evicts whichever was read the fewest times, a window-LFU-style heuristic), strict `lru`, or strict `lfu` (scans every live entry for the true global-coldest key, no recency window); expired entries are always reclaimed before live ones regardless of policy. Optional disk persistence (`INKCACHE_PERSIST_PATH`) so the cache's contents survive a restart instead of always starting empty — atomic writes, loads on startup, saves on an interval and on graceful shutdown
- REST API (Express): `/set`, `/get/:key`, `/delete/:key`, `/invalidate`, `/keys`, `/keys/stats`, `/snapshot`, `/restore`, `/flush`, `/metrics`, `/metrics/history`, `/health`, `/version`, with real per-op latency instrumentation (avg/p95), hit-rate and rolling throughput, JSON error responses (400/404) instead of Express's default HTML pages, and graceful shutdown on SIGINT/SIGTERM
- ASCII-terminal dashboard (React + Vite + Tailwind + react-router-dom), two routes:
  - `/` — a single-screen hero: a **rotating ASCII moon** (a real 3D sphere — spherical sampling, per-cell depth buffer, diffuse lighting against a fixed world-space light, limb darkening, and an object-space crater field — rasterized to characters instead of pixels, with rotation speed driven by live ops/sec) beside a hand-built 5×7 bitmap-font headline, a live node readout as a dot-leader manifest, and a link into the console, all in front of a deterministic ASCII starfield
  - `/dashboard` — a dense tiled ops-console grid: hits-vs-misses and latency (avg/p95) line charts plotted on a character grid, a node-counters table, a hottest-keys bar chart, a store-capacity meter, a keyboard-driven KV console (`set k v [ttl]`, `get k`, `del k`, `invalidate prefix`, `flush`), a KEYS access-frequency heat map using shade glyphs (`░▒▓█`) sorted hottest-first, a colour-coded op stream where every line also carries its kind as text, optional synthesized sound cues (Web Audio, off by default), a glyph + label node status, synthetic traffic simulator (fires real requests), and a POST-style boot screen
  - No WebGL anywhere — the sphere is pure math over a character grid, which is why the whole dashboard ships in a single ~273 KB JS bundle plus ~50 KB CSS. Both routes respect `prefers-reduced-motion` (the moon holds a static lit frame rather than just slowing down)
- Unit + API tests (`npm test`) and a GitHub Actions CI workflow running them on every push/PR
- A benchmark suite (`npm run benchmark`) comparing all three eviction policies under real HTTP load against a deliberately undersized cache, reporting hit rate and evictions alongside raw throughput/latency, plus `npm run benchmark:external` comparing InkCache against real Redis and Memcached containers over each backend's own native protocol
- Single-primary replication (`INKCACHE_ROLE=replica` + `INKCACHE_PRIMARY_URL`): a primary forwards every write to its replicas over HTTP, and a replica pulls a full snapshot from its primary once at startup — see [docs/api.md#replication](docs/api.md#replication)
- Consistent hashing + a cluster gateway (`npm run start:gateway`, `INKCACHE_CLUSTER_NODES`): shards keys across a set of nodes so a client can talk to one address instead of knowing which node owns which key, with active health checking that pulls a dead node out of rotation (and back in once it recovers) — see [docs/api.md#cluster-gateway](docs/api.md#cluster-gateway)

**Not yet implemented (roadmap):** dynamic node discovery — the gateway's node _list_ is still fixed at its own startup (it detects an already-configured node going up/down, but not a new node joining), and replication's primary/replica set is still a fixed, manually-configured pair with no automatic promotion if the primary itself goes down. The "adaptive intelligence layer" in the architecture diagram below is still aspirational as a learned/trained model — what exists today is the access-aware eviction heuristic above, which is real engineering (bounded-window frequency scoring) but not machine learning. Nothing in the dashboard is mocked — every number comes from the running node.

## Key Features

- **Core Cache Engine** — configurable eviction (access-aware frequency/recency hybrid, strict LRU, or strict LFU), TTL support, single-threaded so there's no locking to get wrong
- **Distributed Architecture** — consistent hashing for key distribution across nodes
- **Replication & Fault Tolerance** — primary-replica model with automatic failover
- **Adaptive Intelligence** — access-pattern-based eviction and predictive prefetching
- **Metrics Dashboard** — real-time hit rate, latency, and node health visualization
- **Benchmarking Suite** — performance comparison against baseline Redis/Memcached setups

## Architecture

```
                     ┌─────────────────────┐
                     │      Client(s)       │
                     └──────────┬───────────┘
                                │
                     ┌──────────▼───────────┐
                     │   Request Router      │
                     │ (Consistent Hashing)  │
                     └──────────┬───────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
   ┌──────▼──────┐       ┌──────▼──────┐       ┌──────▼──────┐
   │  Cache Node  │       │  Cache Node  │       │  Cache Node  │
   │  (Primary)   │◄─────►│  (Replica)   │◄─────►│  (Replica)   │
   └──────┬──────┘       └─────────────┘       └─────────────┘
          │
   ┌──────▼──────┐
   │  Adaptive    │
   │  Intelligence│
   │  Layer       │
   │ (pattern     │
   │  tracking +  │
   │  prefetch)   │
   └─────────────┘
```

> Detailed architecture diagrams and design decisions will move to
> `docs/architecture.md` once the distributed layer above is real; for now
> the single-node core/API/dashboard are documented in [`docs/api.md`](docs/api.md) and this README.

## Tech Stack

| Layer              | Technology                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Core Cache Engine  | Node.js / TypeScript                                                                                                            |
| Networking         | TCP sockets / gRPC (TBD)                                                                                                        |
| Consistent Hashing | Custom implementation                                                                                                           |
| Adaptive Layer     | Python microservice (pattern modeling)                                                                                          |
| Dashboard          | React + Vite + Tailwind (ASCII terminal), react-router-dom                                                                      |
| 3D Hero            | Hand-written character-grid sphere renderer (no WebGL)                                                                          |
| Testing            | node:test, Supertest                                                                                                            |
| Benchmarking       | autocannon / custom load-test scripts                                                                                           |
| Deployment         | Dockerfile + docker-compose for the node; the dashboard is a static build (deployable to Vercel, see [Deployment](#deployment)) |

## Project Roadmap

Development follows CUSoC's bi-weekly sprint cadence across three quarters.

### Quarter I — Engineering Foundation

- [x] Sprint 1: Single-node cache core (TTL, web console + API), including strict LFU as a standalone policy (`INKCACHE_EVICTION_POLICY=lfu`) alongside the access-aware hybrid below
- [x] Sprint 2: Benchmarking baseline (`npm run benchmark`,
      comparing `lru`/`access-aware`/`lfu` under real HTTP load), cache
      invalidation strategies beyond TTL expiry (`POST /invalidate`,
      bulk-removes every key matching a prefix), basic metrics
      logging (`GET /metrics/history`, a rolling 1-hour in-memory
      window sampled every 10s) — trend visibility beyond the single
      instantaneous `/metrics` snapshot — and opt-in disk persistence
      (`INKCACHE_PERSIST_PATH`) so the store survives a restart instead
      of always starting empty.

### Quarter II — Product Engineering

- [x] Sprint 3: Multi-node replication (primary-replica model) —
      `INKCACHE_ROLE=replica` + `INKCACHE_PRIMARY_URL`, see
      [docs/api.md#replication](docs/api.md#replication). Single fixed
      primary, best-effort/asynchronous, not consensus-based.
- [x] Sprint 4 (partial): Consistent hashing (`src/core/hashring.ts`), a
      cluster gateway that shards keys across a node set via
      `INKCACHE_CLUSTER_NODES` (`npm run start:gateway`), and failure
      handling — the gateway actively health-checks every node and pulls
      a dead one out of the hashing ring (and back in once it recovers),
      verified with a real test that kills and revives an actual node
      process. See [docs/api.md#cluster-gateway](docs/api.md#cluster-gateway).
      Dynamic node **discovery** is still open: the gateway's node
      _list_ is fixed at its own startup — scaling the cluster in or out
      means restarting it with a new `INKCACHE_CLUSTER_NODES`, not
      something it notices on its own.
- [x] Sprint 5 (partial): Access-pattern-aware eviction — bounded-window frequency scoring on top of recency (`INKCACHE_EVICTION_POLICY=access-aware`, see [docs/api.md](docs/api.md#eviction-policy)). Predictive prefetching and a trained/learned model are still open.

### Quarter III — Production & Leadership

- [x] Sprint 6: Metrics dashboard (single-node version done early), load
      testing (`npm run benchmark`, see Sprint 2), and benchmarking
      against actual Redis/Memcached instances (`npm run benchmark:external`,
      real containers over each backend's own protocol — a
      throughput/latency comparison, not an eviction one; see the file
      header for why the two aren't equivalent to compare)
- [ ] Sprint 7: Deployment, final documentation, demo preparation

> Full milestone tracking is maintained via GitHub Issues and Milestones.

## Getting Started

### Prerequisites

- Node.js ≥ 20.4 (the test suite uses `node:test`'s Date-mocking timers, which need 20.4+)
- npm or yarn
- Docker (optional — only needed for the [Dockerfile](#deployment)-based deploy path, not for local dev)

### Installation

```bash
# Clone the repository
git clone https://github.com/Saatvik-GT/InkCache.git
cd InkCache

# Install dependencies (node + dashboard)
npm install
npm --prefix src/dashboard install

# Run cache node + dashboard together
npm run dev
```

The cache node listens on `http://localhost:8080`; the dashboard is served
at `http://localhost:5173` (`/` is the home page, `/dashboard` is the live
console) and reaches the node through the `/api` dev proxy.
To run them separately: `npm run dev:node` and `npm run dev:dashboard`.

In the dashboard: press `/` to focus the KV console, `s` to toggle the
synthetic traffic simulator, `m` to toggle sound cues (off by default).

### Running a Local Cluster

Not available yet — multi-node support arrives with the Quarter II sprints.

## Usage

```bash
# Set a key
curl -X POST http://localhost:8080/set \
  -H "Content-Type: application/json" \
  -d '{"key":"user:1","value":"Saatvik","ttl":300}'

# Get a key
curl http://localhost:8080/get/user:1

# Delete a key
curl -X DELETE http://localhost:8080/delete/user:1
```

## API Reference

| Method | Endpoint              | Description                                            |
| ------ | --------------------- | ------------------------------------------------------ |
| POST   | `/set`                | Store a key-value pair with optional TTL               |
| GET    | `/get/:key`           | Retrieve a value by key                                |
| DELETE | `/delete/:key`        | Remove a key from the cache                            |
| POST   | `/invalidate`         | Bulk-remove every key matching a prefix                |
| GET    | `/keys`               | List active (non-expired) keys                         |
| GET    | `/keys/stats`         | Per-key hit counts + TTL (one pass)                    |
| GET    | `/snapshot`           | Every live key's value + TTL, for backup/restore       |
| POST   | `/restore`            | Bulk-load a `/snapshot`-shaped keys array              |
| POST   | `/flush`              | Clear the entire store (dev/demo)                      |
| GET    | `/metrics`            | Retrieve this node's metrics                           |
| GET    | `/metrics/history`    | Last hour of periodic metrics snapshots (10s interval) |
| GET    | `/health`             | Node health check                                      |
| GET    | `/version`            | Package name + version                                 |
| POST   | `/internal/replicate` | Internal — a primary pushes ops to its replicas here   |

> Full API documentation available in [`docs/api.md`](docs/api.md).

## Testing

```bash
# Core cache logic + REST routes (supertest), plus the dashboard's
# pure-function lib code (ASCII rendering, plotting, log store, ...)
npm test
```

CI also runs backend typecheck, `prettier --check`, the dashboard's
`oxlint`, the dashboard build, and a Docker build-and-run smoke test
against `/health` on every push/PR — see
[CONTRIBUTING.md](CONTRIBUTING.md) for the full local pre-PR checklist.

```bash
# Compares lru / access-aware / lfu under real HTTP load: spins up a
# separate node per policy, seeds an 800-key skewed population against a
# deliberately small 200-entry cache to force real eviction pressure, and
# reports hit rate + evictions alongside autocannon's throughput/latency.
npm run benchmark
```

Not a CI step (it takes ~30-60s and is meaningful to read, not just
pass/fail) — run it locally when comparing eviction policies. See
[`scripts/benchmark.ts`](scripts/benchmark.ts) for the exact workload
shape and parameters.

```bash
# Compares InkCache against real Redis and Memcached containers, each
# talked to over its own native protocol -- a throughput/latency
# comparison, not an eviction one (see the file header for why).
# Requires Docker running locally.
npm run benchmark:external
```

See [`scripts/benchmark-external.ts`](scripts/benchmark-external.ts) for
the exact workload and why eviction effectiveness isn't part of this
particular comparison.

## Deployment

The cache node and the dashboard are deployed separately — the node needs
a long-running process (in-memory store, TTL sweeper), the dashboard is a
static build.

**Node**, via the included `Dockerfile`:

```bash
docker compose up --build
# or: npm run docker:build && npm run docker:run
```

Deploys to any host that runs a container off a Dockerfile — Render,
Railway, Fly.io, a VPS. **Not Vercel** for this half: Vercel's functions
are stateless/serverless, so the in-memory cache would be wiped between
invocations and the TTL sweeper couldn't run — that would defeat the
entire point of a cache.

**Dashboard**, as a static build (`npm --prefix src/dashboard run build`)
— this part deploys fine to Vercel (a `vercel.json` with SPA rewrites is
already in `src/dashboard/`). This repo is a monorepo — the root
`package.json` is the backend's, not a frontend project — so **set
Vercel's Project → Root Directory to `src/dashboard`**, otherwise Vercel
will try to build the wrong package.json and fail before it ever reads
`vercel.json`. Point it at a node running elsewhere by setting
`VITE_API_BASE` at build time (see
[`src/dashboard/.env.example`](src/dashboard/.env.example)), and add that
dashboard's origin to `INKCACHE_CORS_ORIGIN` on the node side (see
[docs/api.md](docs/api.md#eviction-policy) for the full env var table).

**Marketing landing page** (`docs/index.html`) — a separate, standalone
ASCII-themed page (no build step, no framework) for GitHub Pages: **Settings
→ Pages → Deploy from branch `main`, folder `/docs`**. This is _not_ the
live console — it's a static pitch page pointing visitors at this repo and
the [Getting Started](#getting-started) instructions, with its own copy of
the ASCII design tokens (kept in sync by hand since it can't import from
the Vite build).

## Project Structure

```
InkCache/
├── readme.md
├── LICENSE
├── CONTRIBUTING.md
├── CHANGELOG.md
├── Dockerfile            # cache node image
├── docker-compose.yml
├── package.json          # node scripts: dev, dev:node, test, format
├── .github/workflows/    # CI: typecheck, format check, test, dashboard lint+build, Docker smoke test
├── src/
│   ├── core/             # Cache engine: CacheStore (TTL + eviction), MetricsCollector, HashRing
│   ├── network/          # app.ts/server.ts (a cache node) + gateway.ts/gateway-server.ts (cluster router) + replication.ts
│   └── dashboard/        # React + Vite + Tailwind dashboard
│       ├── vercel.json   # SPA rewrites for static hosting
│       └── src/pages/    # Home.tsx (/) and Dashboard.tsx (/dashboard)
├── tests/                # node:test + supertest: core cache logic + REST routes
├── scripts/
│   ├── benchmark.ts      # npm run benchmark: lru/access-aware/lfu under real HTTP load
│   └── benchmark-external.ts # npm run benchmark:external: vs. real Redis/Memcached
└── docs/
    ├── api.md             # full endpoint + config reference
    ├── security-notes.md  # why react-router-dom stays on the 7.18.x line
    ├── index.html         # standalone GitHub Pages landing page (no build step)
    └── ascii-art.gif      # its background asset
```

Planned additions per roadmap: `src/intelligence/` (the adaptive layer).

## Documentation

- Installation and usage — see [Getting Started](#getting-started) and [Usage](#usage) above
- [API Documentation](docs/api.md)
- [Change Log](CHANGELOG.md)
- [Contributing Guide](CONTRIBUTING.md)

Not written yet (roadmap-gated — no point documenting a schema or
architecture that doesn't exist until the distributed layer does):
a dedicated user guide, architecture diagram, database schema, and
testing report.

## Contributing

This project is developed as part of CUSoC under mentor guidance. Contribution workflow:

1. Create an issue describing the feature/bug
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit with meaningful messages
4. Open a pull request referencing the issue
5. Address mentor/reviewer feedback before merge

## Acknowledgements

- **Chandigarh University Season of Code (CUSoC)** — C Square Club
- Mentors and reviewers guiding this project

## License

This project is licensed under the [MIT License](LICENSE).

---

_Build with purpose. Collaborate with integrity. Contribute with impact._
