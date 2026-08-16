/**
 * Real end-to-end auth + rate-limit test: spawns actual server.ts and
 * gateway-server.ts processes with INKCACHE_API_KEY / INKCACHE_RATE_LIMIT
 * set, and drives them over real HTTP -- same rationale as the other
 * *-e2e test files (these env vars are read once at module load, so
 * testing the real wiring needs real separate processes).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";

function waitForHealth(base: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  return (async function poll(): Promise<void> {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() - start > timeoutMs) throw new Error(`node at ${base} never became healthy`);
    await new Promise((r) => setTimeout(r, 150));
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

describe("auth + rate limiting (real processes)", () => {
  const procs: ChildProcess[] = [];

  after(async () => {
    for (const p of procs) p.kill();
    await Promise.all(procs.map((p) => waitForExit(p)));
  });

  it("a node with INKCACHE_API_KEY set rejects unauthenticated requests and accepts the correct key", async () => {
    const port = 8103;
    const base = `http://localhost:${port}`;
    const node = spawn(process.execPath, ["--import", "tsx", "src/network/server.ts"], {
      env: { ...process.env, INKCACHE_PORT: String(port), INKCACHE_API_KEY: "demo-secret" },
      stdio: "ignore",
    });
    procs.push(node);
    await waitForHealth(base); // /health itself must stay open with no key

    const unauthed = await fetch(`${base}/get/anything`);
    assert.equal(unauthed.status, 401);

    const wrongKey = await fetch(`${base}/get/anything`, { headers: { "x-api-key": "wrong" } });
    assert.equal(wrongKey.status, 401);

    const authed = await fetch(`${base}/set`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "demo-secret" },
      body: JSON.stringify({ key: "k", value: "v" }),
    });
    assert.equal(authed.status, 200);

    const authedRead = await fetch(`${base}/get/k`, { headers: { "x-api-key": "demo-secret" } });
    assert.equal(authedRead.status, 200);

    const bearer = await fetch(`${base}/get/k`, {
      headers: { authorization: "Bearer demo-secret" },
    });
    assert.equal(bearer.status, 200);
  });

  it("replication carries the shared API key -- a replica accepts its primary's forwarded writes", async () => {
    const primaryPort = 8104;
    const replicaPort = 8105;
    const primaryUrl = `http://localhost:${primaryPort}`;
    const replicaUrl = `http://localhost:${replicaPort}`;
    const key = "cluster-secret";

    const primary = spawn(process.execPath, ["--import", "tsx", "src/network/server.ts"], {
      env: {
        ...process.env,
        INKCACHE_PORT: String(primaryPort),
        INKCACHE_API_KEY: key,
        INKCACHE_REPLICA_URLS: replicaUrl,
      },
      stdio: "ignore",
    });
    procs.push(primary);
    await waitForHealth(primaryUrl);

    const replica = spawn(process.execPath, ["--import", "tsx", "src/network/server.ts"], {
      env: {
        ...process.env,
        INKCACHE_PORT: String(replicaPort),
        INKCACHE_API_KEY: key,
        INKCACHE_ROLE: "replica",
        INKCACHE_PRIMARY_URL: primaryUrl,
      },
      stdio: "ignore",
    });
    procs.push(replica);
    await waitForHealth(replicaUrl);

    await fetch(`${primaryUrl}/set`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({ key: "replicated", value: "hello" }),
    });

    // Poll: forwardToReplicas() is fire-and-forget.
    const start = Date.now();
    let landed = false;
    while (Date.now() - start < 3000) {
      const res = await fetch(`${replicaUrl}/get/replicated`, { headers: { "x-api-key": key } });
      if (res.status === 200) {
        landed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(
      landed,
      "replicated write never landed on the replica -- did the auth header get forwarded?",
    );
  });

  it("the gateway carries the shared API key when proxying to a node", async () => {
    const nodePort = 8106;
    const gatewayPort = 8107;
    const nodeUrl = `http://localhost:${nodePort}`;
    const gatewayUrl = `http://localhost:${gatewayPort}`;
    const key = "gateway-secret";

    const node = spawn(process.execPath, ["--import", "tsx", "src/network/server.ts"], {
      env: { ...process.env, INKCACHE_PORT: String(nodePort), INKCACHE_API_KEY: key },
      stdio: "ignore",
    });
    procs.push(node);
    await waitForHealth(nodeUrl);

    const gateway = spawn(process.execPath, ["--import", "tsx", "src/network/gateway-server.ts"], {
      env: {
        ...process.env,
        INKCACHE_GATEWAY_PORT: String(gatewayPort),
        INKCACHE_CLUSTER_NODES: nodeUrl,
        INKCACHE_API_KEY: key,
      },
      stdio: "ignore",
    });
    procs.push(gateway);
    await waitForHealth(gatewayUrl);

    // The gateway itself requires the key too.
    const unauthed = await fetch(`${gatewayUrl}/set`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: "v" }),
    });
    assert.equal(unauthed.status, 401);

    // With the key, the gateway both accepts the client and correctly
    // re-authenticates itself to the node it proxies to.
    const authed = await fetch(`${gatewayUrl}/set`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({ key: "k", value: "v" }),
    });
    assert.equal(authed.status, 200);

    const directRead = await fetch(`${nodeUrl}/get/k`, { headers: { "x-api-key": key } });
    assert.equal(directRead.status, 200);
  });

  it("a node with INKCACHE_RATE_LIMIT set returns real 429s over real HTTP once exceeded", async () => {
    const port = 8108;
    const base = `http://localhost:${port}`;
    const node = spawn(process.execPath, ["--import", "tsx", "src/network/server.ts"], {
      env: {
        ...process.env,
        INKCACHE_PORT: String(port),
        INKCACHE_RATE_LIMIT: "3",
        INKCACHE_RATE_LIMIT_WINDOW: "5",
      },
      stdio: "ignore",
    });
    procs.push(node);
    await waitForHealth(base); // health checks themselves must not count against the limit

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${base}/get/anything`);
      statuses.push(res.status);
    }
    assert.deepEqual(statuses, [404, 404, 404, 429, 429]);
  });
});
