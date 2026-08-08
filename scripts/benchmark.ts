/**
 * Benchmark harness: spins up a real, separate InkCache node per eviction
 * policy, seeds it with a skewed key population, runs a mixed read/write
 * HTTP load against it with autocannon, and reports both autocannon's raw
 * HTTP numbers and the node's own /metrics (hit rate, evictions) side by
 * side -- the interesting comparison isn't "how fast" (all three policies
 * run the same code path per request) but "how effective", which only
 * shows up once the key pool is bigger than maxEntries and real eviction
 * pressure kicks in.
 *
 * Run: npm run benchmark
 */
import { spawn, type ChildProcess } from "node:child_process";
import autocannon from "autocannon";

const POLICIES = ["lru", "access-aware", "lfu"] as const;
const BASE_PORT = 8098; // distinct from the dev node's default 8080
const MAX_ENTRIES = 200; // small on purpose: forces real eviction pressure
const POOL_SIZE = 800; // >> MAX_ENTRIES, so a policy that doesn't protect
// hot keys well will visibly miss more often
const DURATION_S = 8;
const CONNECTIONS = 20;
const WRITE_PROB = 0.15; // 85% reads, 15% writes -- read-heavy, like real cache traffic

interface PolicyResult {
  policy: string;
  requestsPerSec: number;
  latencyAvgMs: number;
  hitRate: number | null;
  evictions: number;
}

/** Same power-law shape as the dashboard's traffic simulator (lib/skewedKey.ts):
    a small fraction of keys get most of the reads, so an eviction policy that
    actually protects hot keys should visibly outperform one that doesn't. */
function skewedKey(): string {
  const idx = Math.floor(POOL_SIZE * Math.pow(Math.random(), 2.4));
  return `bench:key:${idx}`;
}

async function waitForHealth(base: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {
      // Node hasn't started listening yet -- keep polling.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`node at ${base} never became healthy within ${timeoutMs}ms`);
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

function startNode(policy: string, port: number): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", "src/network/server.ts"], {
    env: {
      ...process.env,
      INKCACHE_PORT: String(port),
      INKCACHE_EVICTION_POLICY: policy,
      INKCACHE_MAX_ENTRIES: String(MAX_ENTRIES),
    },
    stdio: "ignore",
  });
}

/** Pre-populate the full key pool so GETs have a realistic hit rate to miss
    from, instead of benchmarking against a cold, empty cache. */
async function seed(base: string): Promise<void> {
  for (let i = 0; i < POOL_SIZE; i++) {
    await fetch(`${base}/set`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: `bench:key:${i}`, value: "x".repeat(64) }),
    });
  }
}

async function benchOne(policy: string, port: number): Promise<PolicyResult> {
  const base = `http://localhost:${port}`;
  const proc = startNode(policy, port);
  try {
    await waitForHealth(base);
    await seed(base);

    const result = await autocannon({
      url: base,
      connections: CONNECTIONS,
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
              request.body = JSON.stringify({ key: skewedKey(), value: "x".repeat(64) });
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

    const metricsRes = await fetch(`${base}/metrics`);
    const metrics = (await metricsRes.json()) as { hitRate: number | null; evictions: number };

    return {
      policy,
      requestsPerSec: result.requests.average,
      latencyAvgMs: result.latency.average,
      hitRate: metrics.hitRate,
      evictions: metrics.evictions,
    };
  } finally {
    proc.kill();
    await waitForExit(proc);
  }
}

function printTable(results: PolicyResult[]): void {
  console.log("\npolicy          reqs/sec   avg latency (ms)   hit rate   evictions");
  console.log("-".repeat(70));
  for (const r of results) {
    const hitRate = r.hitRate === null ? "n/a" : `${(r.hitRate * 100).toFixed(1)}%`;
    console.log(
      `${r.policy.padEnd(15)} ${r.requestsPerSec.toFixed(0).padStart(8)}   ` +
        `${r.latencyAvgMs.toFixed(2).padStart(17)}   ${hitRate.padStart(8)}   ` +
        `${String(r.evictions).padStart(9)}`,
    );
  }
  console.log();
}

async function main(): Promise<void> {
  console.log(
    `Benchmarking ${POLICIES.length} eviction policies: ${MAX_ENTRIES} max entries, ` +
      `${POOL_SIZE}-key skewed pool, ${DURATION_S}s/policy, ${CONNECTIONS} connections, ` +
      `${(WRITE_PROB * 100).toFixed(0)}% writes.\n`,
  );
  const results: PolicyResult[] = [];
  for (const [i, policy] of POLICIES.entries()) {
    console.log(`Running ${policy}...`);
    results.push(await benchOne(policy, BASE_PORT + i));
  }
  printTable(results);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
