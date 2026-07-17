# InkCache — Intelligent Distributed Caching System

> An adaptive, distributed key-value caching layer that goes beyond static eviction policies by learning access patterns to optimize hit rates, reduce latency, and scale horizontally across nodes.

[![Status](https://img.shields.io/badge/status-in%20development-yellow)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()
[![Program](https://img.shields.io/badge/CUSoC-2026-orange)]()

---

## Table of Contents

- [Overview](#overview)
- [Problem Statement](#problem-statement)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Roadmap](#project-roadmap)
- [Getting Started](#getting-started)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Acknowledgements](#acknowledgements)
- [License](#license)

---

## Overview

InkCache is a distributed caching system built as part of the **Chandigarh University Season of Code (CUSoC)** program under subject code **24CSI-305 (Institute/Industrial Summer Training)**.

Traditional caching layers (Redis, Memcached) rely on static eviction policies — LRU, LFU, or fixed TTLs — that don't adapt to changing access patterns. InkCache aims to layer *intelligence* on top of a solid distributed caching foundation: predicting hot keys, adapting eviction dynamically, and rebalancing load across nodes without manual tuning.

## Problem Statement

Modern applications serve highly skewed, time-varying access patterns (diurnal traffic, sudden hotspots, seasonal spikes) that static caching policies handle poorly — leading to unnecessary cache misses, wasted memory on cold keys, and uneven load across distributed nodes.

InkCache addresses this by combining:
1. A **correct, performant distributed cache core** (replication, consistent hashing, failure handling)
2. An **adaptive intelligence layer** that learns access patterns and adjusts eviction/prefetching decisions accordingly

## Current Status

**Implemented and working today (single-node demo):**

- In-memory cache core: get/set/delete, TTL with lazy expiry + background sweep, LRU eviction (expired entries reclaimed before live ones)
- REST API (Express): `/set`, `/get/:key`, `/delete/:key`, `/metrics`, `/health`, with real per-op latency instrumentation (avg/p95), hit-rate and rolling throughput
- CRT-terminal dashboard (React + Vite + Tailwind): keyboard-driven KV console (`set k v [ttl]`, `get k`, `del k`), live metrics readout polling every second, color-coded hit/miss/evict op stream, node online/offline indicator, synthetic traffic simulator (fires real requests), boot sequence
- Unit tests for the core cache logic (`npm test`)

**Not yet implemented (roadmap):** multi-node replication, consistent hashing, failover, the adaptive intelligence layer, LFU policy, and the benchmarking suite. Nothing in the dashboard is mocked — every number comes from the running node.

## Key Features

-  **Core Cache Engine** — configurable LRU/LFU eviction, TTL support, thread-safe operations
-  **Distributed Architecture** — consistent hashing for key distribution across nodes
- **Replication & Fault Tolerance** — primary-replica model with automatic failover
-  **Adaptive Intelligence** — access-pattern-based eviction and predictive prefetching
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

> Detailed architecture diagrams and design decisions are maintained in [`docs/architecture.md`](docs/architecture.md).

## Tech Stack

| Layer               | Technology                          |
|---------------------|--------------------------------------|
| Core Cache Engine   | Node.js / TypeScript                 |
| Networking          | TCP sockets / gRPC (TBD)             |
| Consistent Hashing  | Custom implementation                |
| Adaptive Layer      | Python microservice (pattern modeling)|
| Metrics Dashboard   | React + Vite + Tailwind (CRT terminal UI) |
| Testing             | Jest, Supertest                      |
| Benchmarking        | autocannon / custom load-test scripts|
| Deployment          | Docker, Docker Compose               |

## Project Roadmap

Development follows CUSoC's bi-weekly sprint cadence across three quarters.

### Quarter I — Engineering Foundation
- [x] Sprint 1: Single-node cache core (LRU eviction, TTL, web console + API) — *LFU policy still pending*
- [ ] Sprint 2: Benchmarking baseline, cache invalidation strategies, basic metrics logging

### Quarter II — Product Engineering
- [ ] Sprint 3: Multi-node replication (primary-replica model)
- [ ] Sprint 4: Consistent hashing, node discovery, failure handling
- [ ] Sprint 5: Adaptive intelligence layer — access pattern tracking + predictive prefetching

### Quarter III — Production & Leadership
- [ ] Sprint 6: Metrics dashboard ✔ (single-node version done early), load testing, benchmarking vs. Redis/Memcached
- [ ] Sprint 7: Deployment, final documentation, demo preparation

> Full milestone tracking is maintained via GitHub Issues and Milestones.

## Getting Started

### Prerequisites

- Node.js ≥ 18.x
- npm or yarn
- Docker (optional, for multi-node local testing)

### Installation

```bash
# Clone the repository
git clone https://github.com/Saatvik-GT/InkCache.git
cd InkCache

# Install dependencies (node + dashboard)
npm install
npm install --prefix src/dashboard

# Run cache node + dashboard together
npm run dev
```

The cache node listens on `http://localhost:8080`; the dashboard is served
at `http://localhost:5173` and reaches the node through the `/api` dev proxy.
To run them separately: `npm run dev:node` and `npm run dev:dashboard`.

In the dashboard: press `/` to focus the KV console, `s` to toggle the
synthetic traffic simulator.

### Running a Local Cluster

Not available yet — multi-node support arrives with the Quarter II sprints.

## Usage

```bash
# Set a key
curl -X POST http://localhost:8080/set -d '{"key":"user:1","value":"Saatvik","ttl":300}'

# Get a key
curl http://localhost:8080/get/user:1

# Delete a key
curl -X DELETE http://localhost:8080/delete/user:1
```

## API Reference

| Method | Endpoint         | Description                    |
|--------|------------------|--------------------------------|
| POST   | `/set`           | Store a key-value pair with optional TTL |
| GET    | `/get/:key`      | Retrieve a value by key        |
| DELETE | `/delete/:key`   | Remove a key from the cache    |
| GET    | `/metrics`       | Retrieve node/cluster metrics  |
| GET    | `/health`        | Node health check              |

> Full API documentation available in [`docs/api.md`](docs/api.md).

## Testing

```bash
# Run unit tests (core cache logic: get/set/delete, TTL, LRU)
npm test
```

Load/benchmark tooling (`npm run benchmark`) is planned for Quarter III.

## Project Structure

```
InkCache/
├── readme.md
├── package.json         # node scripts: dev, dev:node, test
├── src/
│   ├── core/            # Cache engine: CacheStore (TTL + LRU), MetricsCollector
│   ├── network/         # Express REST layer (/set /get /delete /metrics /health)
│   └── dashboard/       # React + Vite + Tailwind CRT terminal monitor
├── tests/               # node:test suite for the cache core
└── docs/                # (planned) architecture, api, testing report
```

Planned additions per roadmap: `src/intelligence/` (adaptive layer),
benchmarking scripts, and the docs set referenced below.

## Documentation

- [Installation Guide](docs/installation.md)
- [User Guide](docs/user-guide.md)
- [API Documentation](docs/api.md)
- [Architecture Diagram](docs/architecture.md)
- [Database Schema](docs/database-schema.md)
- [Testing Report](docs/testing-report.md)
- [Change Log](CHANGELOG.md)

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

*Build with purpose. Collaborate with integrity. Contribute with impact.*
