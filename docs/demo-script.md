# InkCache — Live Demo Script

A runnable walkthrough of every real feature, in the order they build
on each other. Every command here has actually been run against a real
node during development — nothing is illustrative-only. Expected output
is shown so you can tell a working step from a broken one.

Estimated time: 10–15 minutes for the full script. Each section is
independent enough to skip if you're short on time — jump straight to
whichever feature you want to show.

## 0. Setup

```bash
npm install
npm run typecheck && npm test   # optional: prove the suite is green first
```

## 1. Single node: the core cache

```bash
npm run start:node
```

In a second terminal:

```bash
curl -X POST http://localhost:8080/set -H "Content-Type: application/json" \
  -d '{"key":"user:1","value":"Saatvik","ttl":300}'
# {"ok":true,"key":"user:1","ttl":300}

curl http://localhost:8080/get/user:1
# {"key":"user:1","value":"Saatvik","ttl":299.9...}

curl http://localhost:8080/metrics
# hits/misses/opsPerSec/latency -- all real, from this session's traffic
```

Talking point: every number in `/metrics` comes from real operations —
nothing in this project is synthesized for the demo, including the
dashboard's charts later.

## 2. Eviction policies

```bash
# stop the node (Ctrl+C), restart small and access-aware (default)
INKCACHE_MAX_ENTRIES=3 npm run start:node
```

```bash
for k in a b c; do curl -s -X POST http://localhost:8080/set \
  -H "Content-Type: application/json" -d "{\"key\":\"$k\",\"value\":\"1\"}" > /dev/null; done
curl -s http://localhost:8080/get/a > /dev/null   # read "a" so it's not the coldest
curl -s -X POST http://localhost:8080/set -H "Content-Type: application/json" \
  -d '{"key":"d","value":"1"}' > /dev/null          # forces an eviction at capacity

curl http://localhost:8080/keys
# "a" survives (it was read); "b" or "c" was evicted, not "a" -- despite
# "a" being the least-recently-inserted, it wasn't the coldest
```

Talking point: `access-aware` (the default) survives a hot key past its
LRU position; `INKCACHE_EVICTION_POLICY=lru` or `=lfu` behave
differently — see [docs/api.md#eviction-policy](api.md#eviction-policy).

## 3. Persistence across a restart

```bash
INKCACHE_PERSIST_PATH=/tmp/inkcache-demo.json npm run start:node
```

```bash
curl -X POST http://localhost:8080/set -H "Content-Type: application/json" \
  -d '{"key":"survives-restart","value":"yes"}'
```

Stop the node (Ctrl+C — the shutdown handler does one final save) and
restart the same command. Then:

```bash
curl http://localhost:8080/get/survives-restart
# {"key":"survives-restart","value":"yes","ttl":null} -- loaded from disk
```

## 4. Predictive access-pattern hints

```bash
curl -X POST http://localhost:8080/set -H "Content-Type: application/json" -d '{"key":"user:1","value":"a"}' > /dev/null
curl -X POST http://localhost:8080/set -H "Content-Type: application/json" -d '{"key":"user:2","value":"b"}' > /dev/null
for i in 1 2 3; do
  curl -s http://localhost:8080/get/user:1 > /dev/null
  curl -s http://localhost:8080/get/user:2 > /dev/null
done

curl http://localhost:8080/predict/user:1
# {"key":"user:1","predictions":[{"key":"user:2","count":3,"probability":1}]}
```

Talking point: this is a real, live-learned statistical pattern (a
bigram frequency table) from the traffic that just happened — not a
trained model, and clearly documented as such in
[docs/api.md#get-predictkey](api.md#get-predictkey).

## 5. Replication (primary + replica)

```bash
# terminal 1: primary
INKCACHE_PORT=8080 INKCACHE_REPLICA_URLS=http://localhost:8081 npm run start:node

# terminal 2: replica
INKCACHE_PORT=8081 INKCACHE_ROLE=replica INKCACHE_PRIMARY_URL=http://localhost:8080 npm run start:node
```

```bash
curl -X POST http://localhost:8080/set -H "Content-Type: application/json" \
  -d '{"key":"replicated","value":"hello"}'
curl http://localhost:8081/get/replicated
# {"key":"replicated","value":"hello","ttl":null} -- forwarded automatically

# the replica refuses direct writes:
curl -i -X POST http://localhost:8081/set -H "Content-Type: application/json" \
  -d '{"key":"nope","value":"x"}'
# HTTP/1.1 409 Conflict
```

## 6. Cluster gateway (sharding + node discovery + failover)

```bash
# three cache nodes
INKCACHE_PORT=8080 npm run start:node
INKCACHE_PORT=8081 npm run start:node
INKCACHE_PORT=8082 npm run start:node

# gateway starting with zero nodes
npm run start:gateway

# each node discovers itself into the gateway
INKCACHE_PORT=8080 INKCACHE_GATEWAY_URL=http://localhost:8090 INKCACHE_SELF_URL=http://localhost:8080 npm run start:node
# (repeat for 8081, 8082 -- or set the env vars on the three nodes above from the start)
```

```bash
curl http://localhost:8090/cluster/nodes
# all three nodes, healthy:true

for i in $(seq 1 12); do curl -s -X POST http://localhost:8090/set \
  -H "Content-Type: application/json" -d "{\"key\":\"k$i\",\"value\":\"v$i\"}" > /dev/null; done
curl http://localhost:8080/keys/stats | grep -o '"count":[0-9]*'
curl http://localhost:8081/keys/stats | grep -o '"count":[0-9]*'
curl http://localhost:8082/keys/stats | grep -o '"count":[0-9]*'
# keys spread across all three nodes, not just one
```

Kill one node (Ctrl+C in its terminal) and show live failover:

```bash
curl http://localhost:8090/cluster/nodes
# the killed node now shows healthy:false, within ~2s (INKCACHE_GATEWAY_HEALTH_INTERVAL)

curl -X POST http://localhost:8090/set -H "Content-Type: application/json" \
  -d '{"key":"still-works","value":"yes"}'
# 200 -- traffic reroutes around the dead node automatically
```

## 7. The dashboard

```bash
npm run dev   # starts both the node and the Vite dashboard dev server
```

Open `http://localhost:5173/dashboard`. Press `s` to start the
synthetic traffic simulator (real HTTP requests against the node you
just started, not mocked data) and narrate the panels: hits/misses and
latency charts, the hottest-keys bar chart, the KEYS heat map, and the
KV console for live manual `set`/`get`/`del`/`invalidate`/`flush`.

## Cleanup

```bash
# stop every node/gateway process (Ctrl+C in each terminal), then:
rm -f /tmp/inkcache-demo.json
```
