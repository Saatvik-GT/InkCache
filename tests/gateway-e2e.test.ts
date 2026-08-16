/**
 * Real end-to-end gateway test: spawns three actual InkCache node
 * processes plus a real gateway process pointed at all three, and
 * drives them over real HTTP -- same rationale as
 * tests/replication-e2e.test.ts (gateway.ts's CLUSTER_NODES is read
 * from process.env once at module load, so testing real multi-node
 * routing needs real separate processes, not one process wearing
 * multiple hats).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { ClusterRouter } from "../src/network/cluster.js";

const NODE_PORTS = [8093, 8094, 8095] as const;
const GATEWAY_PORT = 8096;
const NODE_URLS = NODE_PORTS.map((p) => `http://localhost:${p}`);
const GATEWAY_URL = `http://localhost:${GATEWAY_PORT}`;

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

describe("cluster gateway (real processes)", () => {
  const procs: ChildProcess[] = [];

  after(async () => {
    for (const p of procs) p.kill();
    await Promise.all(procs.map((p) => waitForExit(p)));
  });

  it("routes writes and reads through to the correct node, load-spreading across the cluster", async () => {
    for (const port of NODE_PORTS) {
      const proc = spawn(process.execPath, ["--import", "tsx", "src/network/server.ts"], {
        env: { ...process.env, INKCACHE_PORT: String(port), INKCACHE_NODE_ID: `node-${port}` },
        stdio: "ignore",
      });
      procs.push(proc);
    }
    await Promise.all(NODE_URLS.map((url) => waitForHealth(url)));

    const gateway = spawn(process.execPath, ["--import", "tsx", "src/network/gateway-server.ts"], {
      env: {
        ...process.env,
        INKCACHE_GATEWAY_PORT: String(GATEWAY_PORT),
        INKCACHE_CLUSTER_NODES: NODE_URLS.join(","),
      },
      stdio: "ignore",
    });
    procs.push(gateway);
    await waitForHealth(GATEWAY_URL);

    // The gateway's own idea of which node owns a key must match a
    // ClusterRouter built the same way in this test process -- the
    // hashing has to be genuinely deterministic across processes, not
    // just within one.
    const router = new ClusterRouter(NODE_URLS);

    const keys = Array.from({ length: 60 }, (_, i) => `key:${i}`);
    for (const key of keys) {
      await fetch(`${GATEWAY_URL}/set`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, value: `value-of-${key}` }),
      });
    }

    // Every key must be readable back through the gateway...
    for (const key of keys) {
      const res = await fetch(`${GATEWAY_URL}/get/${key}`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { value: string };
      assert.equal(body.value, `value-of-${key}`);
    }

    // ...and must have actually landed on the node the router predicts,
    // not just "some node" -- read each node directly and confirm the
    // gateway's routing decision matches reality.
    for (const key of keys) {
      const expectedNode = router.nodeFor(key)!;
      const res = await fetch(`${expectedNode}/get/${key}`);
      assert.equal(res.status, 200, `${key} was not found on the node the router predicted`);
    }

    // Every configured node should have received at least one key --
    // proof the gateway is actually spreading load, not just always
    // picking the first node.
    const counts = await Promise.all(
      NODE_URLS.map(async (url) => {
        const res = await fetch(`${url}/keys`);
        const body = (await res.json()) as { count: number };
        return body.count;
      }),
    );
    for (const count of counts) assert.ok(count > 0, "a node in the cluster received zero keys");

    // /cluster/nodes and /cluster/route/:key both reflect real state.
    const nodesRes = await fetch(`${GATEWAY_URL}/cluster/nodes`);
    const nodesBody = (await nodesRes.json()) as { nodes: string[]; count: number };
    assert.equal(nodesBody.count, 3);
    assert.deepEqual(nodesBody.nodes.sort(), [...NODE_URLS].sort());

    const routeRes = await fetch(`${GATEWAY_URL}/cluster/route/${keys[0]}`);
    const routeBody = (await routeRes.json()) as { node: string };
    assert.equal(routeBody.node, router.nodeFor(keys[0]!));

    // Deleting through the gateway removes it from the node it actually lives on.
    await fetch(`${GATEWAY_URL}/delete/${keys[0]}`, { method: "DELETE" });
    const afterDelete = await fetch(`${GATEWAY_URL}/get/${keys[0]}`);
    assert.equal(afterDelete.status, 404);
  });

  it("returns 503 from the gateway when no cluster nodes are configured", async () => {
    const gateway = spawn(process.execPath, ["--import", "tsx", "src/network/gateway-server.ts"], {
      env: {
        ...process.env,
        INKCACHE_GATEWAY_PORT: "8097",
        INKCACHE_CLUSTER_NODES: "",
      },
      stdio: "ignore",
    });
    procs.push(gateway);
    await waitForHealth("http://localhost:8097");

    const res = await fetch("http://localhost:8097/get/anything");
    assert.equal(res.status, 503);
  });
});
