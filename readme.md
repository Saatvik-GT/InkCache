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
| Metrics Dashboard   | React + Recharts                     |
| Testing             | Jest, Supertest                      |
| Benchmarking        | autocannon / custom load-test scripts|
| Deployment          | Docker, Docker Compose               |

## Project Roadmap

Development follows CUSoC's bi-weekly sprint cadence across three quarters.

### Quarter I — Engineering Foundation
- [ ] Sprint 1: Single-node cache core (LRU/LFU eviction, TTL, CLI + API)
- [ ] Sprint 2: Benchmarking baseline, cache invalidation strategies, basic metrics logging

### Quarter II — Product Engineering
- [ ] Sprint 3: Multi-node replication (primary-replica model)
- [ ] Sprint 4: Consistent hashing, node discovery, failure handling
- [ ] Sprint 5: Adaptive intelligence layer — access pattern tracking + predictive prefetching

### Quarter III — Production & Leadership
- [ ] Sprint 6: Metrics dashboard, load testing, benchmarking vs. Redis/Memcached
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
git clone https://github.com/<your-username>/inkcache.git
cd inkcache

# Install dependencies
npm install

# Run a single cache node
npm run start:node
```

### Running a Local Cluster

```bash
docker-compose up --build
```

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
# Run unit tests
npm test

# Run load/benchmark tests
npm run benchmark
```

Test cases, results, and bug resolution logs are tracked in [`docs/testing-report.md`](docs/testing-report.md).

## Project Structure

```
InkCache/
├── README.md
├── LICENSE
├── docs/
│   ├── architecture.md
│   ├── api.md
│   ├── database-schema.md
│   └── testing-report.md
├── src/
│   ├── core/           # Cache engine (eviction, TTL)
│   ├── network/        # Node communication, consistent hashing
│   ├── intelligence/    # Adaptive prefetching & pattern tracking
│   └── dashboard/       # Metrics visualization
├── tests/
├── assets/
├── presentation/
├── report/
└── media/
```

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
