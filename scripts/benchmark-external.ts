/**
 * Benchmark InkCache against real Redis and Memcached under the same
 * read/write workload. Separate from scripts/benchmark.ts (which compares
 * InkCache's own three eviction policies and needs nothing but Node) on
 * purpose: this one needs Docker running, and shouldn't make the simpler,
 * dependency-free comparison unusable for anyone without it.
 *
 * This is a throughput/latency comparison, not an eviction-effectiveness
 * one -- Redis (memory-based maxmemory) and Memcached (slab-based -m) don't
 * evict the same way InkCache's entry-count-based maxEntries does, so
 * there's no way to give all three an equivalent "coldest key gets
 * evicted first" test. Both are configured with generous memory limits
 * here specifically so no eviction happens during the run, keeping the
 * comparison to what it actually can measure fairly: raw ops/sec and
 * latency for the same get/set mix, talked to over each backend's own
 * native protocol (not HTTP -- autocannon only speaks HTTP, and fronting
 * Redis/Memcached with a REST shim just to reuse it would be measuring
 * that shim, not them).
 *
 * Run: npm run benchmark:external
 */
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { Redis } from "ioredis";
import memjs from "memjs";
import autocannon from "autocannon";

const POOL_SIZE = 800;
const DURATION_S = 8;
const CONCURRENCY = 20;
const WRITE_PROB = 0.15; // 85% reads, 15% writes -- same shape as scripts/benchmark.ts
const VALUE = "x".repeat(64);

function skewedKey(): string {
  // Same power-law shape as scripts/benchmark.ts / the dashboard's traffic
  // simulator: a small fraction of keys get most of the reads.
  const idx = Math.floor(POOL_SIZE * Math.pow(Math.random(), 2.4));
  return `bench:key:${idx}`;
}

interface Result {
  backend: string;
  opsPerSec: number;
  avgLatencyMs: number;
  hitRate: number | null;
}

/** Fixed-duration, fixed-concurrency workload against any get/set pair --
    the shared driver for Redis and Memcached, which speak different wire
    protocols but both reduce to the same two operations here. */
async function runWorkload(
  get: (key: string) => Promise<boolean>,
  set: (key: string, value: string) => Promise<void>,
): Promise<{ opsPerSec: number; avgLatencyMs: number; hitRate: number | null }> {
  const deadline = Date.now() + DURATION_S * 1000;
  let ops = 0;
  let totalLatencyMs = 0;
  let hits = 0;
  let reads = 0;

  async function worker(): Promise<void> {
    while (Date.now() < deadline) {
      const start = performance.now();
      if (Math.random() < WRITE_PROB) {
        await set(skewedKey(), VALUE);
      } else {
        reads++;
        if (await get(skewedKey())) hits++;
      }
      totalLatencyMs += performance.now() - start;
      ops++;
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return {
    opsPerSec: ops / DURATION_S,
    avgLatencyMs: ops > 0 ? totalLatencyMs / ops : 0,
    hitRate: reads > 0 ? hits / reads : null,
  };
}

function dockerRun(args: string[]): void {
  execSync(`docker run ${args.join(" ")}`, { stdio: "ignore" });
}

function dockerCleanup(name: string): void {
  try {
    execSync(`docker rm -f ${name}`, { stdio: "ignore" });
  } catch {
    // Nothing to clean up -- fine, this is a best-effort pre/post-run wipe.
  }
}

async function waitUntilReady(check: () => Promise<void>, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      await check();
      return;
    } catch (err) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`backend never became ready: ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

async function benchRedis(): Promise<Result> {
  const name = "inkcache-bench-redis";
  dockerCleanup(name);
  // --maxmemory generous on purpose -- see the file header on why eviction
  // isn't part of what this comparison measures.
  dockerRun([
    "-d",
    "--rm",
    `--name ${name}`,
    "-p 16379:6379",
    "redis:7-alpine",
    "redis-server --maxmemory 64mb --maxmemory-policy allkeys-lru",
  ]);

  const redis = new Redis({
    port: 16379,
    host: "127.0.0.1",
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  try {
    await waitUntilReady(async () => {
      await redis.connect();
      await redis.ping();
    });

    for (let i = 0; i < POOL_SIZE; i++) {
      await redis.set(`bench:key:${i}`, VALUE);
    }

    const { opsPerSec, avgLatencyMs, hitRate } = await runWorkload(
      async (key) => (await redis.get(key)) !== null,
      async (key, value) => {
        await redis.set(key, value);
      },
    );
    return { backend: "redis", opsPerSec, avgLatencyMs, hitRate };
  } finally {
    redis.disconnect();
    dockerCleanup(name);
  }
}

async function benchMemcached(): Promise<Result> {
  const name = "inkcache-bench-memcached";
  dockerCleanup(name);
  // -m 64 (megabytes) -- same "generous, no eviction" intent as Redis above.
  dockerRun(["-d", "--rm", `--name ${name}`, "-p 16211:11211", "memcached:1.6-alpine", "-m 64"]);

  const mc = memjs.Client.create("127.0.0.1:16211", { retries: 0, timeout: 1 });
  try {
    await waitUntilReady(async () => {
      await mc.set("__ready__", Buffer.from("1"), {});
      const { value } = await mc.get("__ready__");
      if (!value) throw new Error("memcached not answering yet");
    });

    for (let i = 0; i < POOL_SIZE; i++) {
      await mc.set(`bench:key:${i}`, Buffer.from(VALUE), {});
    }

    const { opsPerSec, avgLatencyMs, hitRate } = await runWorkload(
      async (key) => {
        const { value } = await mc.get(key);
        return value !== null;
      },
      async (key, value) => {
        await mc.set(key, Buffer.from(value), {});
      },
    );
    return { backend: "memcached", opsPerSec, avgLatencyMs, hitRate };
  } finally {
    mc.close();
    dockerCleanup(name);
  }
}

function waitForHealth(base: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  return (async function poll(): Promise<void> {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() - start > timeoutMs) throw new Error(`node at ${base} never became healthy`);
    await new Promise((r) => setTimeout(r, 100));
    return poll();
  })();
}

function waitForExit(proc: ChildProcess, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function benchInkCache(): Promise<Result> {
  const port = 8095;
  const base = `http://localhost:${port}`;
  const proc = spawn(process.execPath, ["--import", "tsx", "src/network/server.ts"], {
    env: { ...process.env, INKCACHE_PORT: String(port), INKCACHE_MAX_ENTRIES: "10000" },
    stdio: "ignore",
  });
  try {
    await waitForHealth(base);
    for (let i = 0; i < POOL_SIZE; i++) {
      await fetch(`${base}/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: `bench:key:${i}`, value: VALUE }),
      });
    }

    const result = await autocannon({
      url: base,
      connections: CONCURRENCY,
      duration: DURATION_S,
      requests: [
        {
          method: "GET",
          path: "/get/placeholder",
          setupRequest: (request) => {
            if (Math.random() < WRITE_PROB) {
              request.method = "POST";
              request.path = "/set";
              request.headers = { "content-type": "application/json" };
              request.body = JSON.stringify({ key: skewedKey(), value: VALUE });
            } else {
              request.method = "GET";
              request.path = `/get/${skewedKey()}`;
              request.body = undefined;
            }
            return request;
          },
        },
      ],
    });

    const metrics = (await (await fetch(`${base}/metrics`)).json()) as {
      hitRate: number | null;
    };

    return {
      backend: "inkcache",
      opsPerSec: result.requests.average,
      avgLatencyMs: result.latency.average,
      hitRate: metrics.hitRate,
    };
  } finally {
    proc.kill();
    await waitForExit(proc);
  }
}

function printTable(results: Result[]): void {
  console.log("\nbackend      reqs/sec   avg latency (ms)   hit rate");
  console.log("-".repeat(52));
  for (const r of results) {
    const hitRate = r.hitRate === null ? "n/a" : `${(r.hitRate * 100).toFixed(1)}%`;
    console.log(
      `${r.backend.padEnd(12)} ${r.opsPerSec.toFixed(0).padStart(8)}   ` +
        `${r.avgLatencyMs.toFixed(2).padStart(17)}   ${hitRate.padStart(8)}`,
    );
  }
  console.log();
}

async function main(): Promise<void> {
  console.log(
    `Benchmarking InkCache vs real Redis and Memcached: ${POOL_SIZE}-key pool, ` +
      `${DURATION_S}s/backend, ${CONCURRENCY} concurrency, ${(WRITE_PROB * 100).toFixed(0)}% writes.\n` +
      `Note: this compares throughput/latency, not eviction effectiveness -- ` +
      `see the top of this file for why.\n`,
  );

  console.log("Running inkcache...");
  const inkcache = await benchInkCache();

  console.log("Running redis...");
  const redis = await benchRedis();

  console.log("Running memcached...");
  const memcached = await benchMemcached();

  printTable([inkcache, redis, memcached]);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
