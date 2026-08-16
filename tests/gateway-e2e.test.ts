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

/** Polls a gateway's /cluster/nodes until it does (or doesn't) list
    `nodeUrl` -- registration/deregistration both happen asynchronously
    (an HTTP round trip from the node to the gateway), so this can't be
    asserted the instant the triggering action returns. */
async function waitUntilGatewayLists(
  gatewayUrl: string,
  nodeUrl: string,
  shouldBeListed: boolean,
  failureMessage: string,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    const res = await fetch(`${gatewayUrl}/cluster/nodes`);
    const body = (await res.json()) as { nodes: Array<{ url: string }> };
    const isListed = body.nodes.some((n) => n.url === nodeUrl);
    if (isListed === shouldBeListed) return;
    if (Date.now() - start > timeoutMs) throw new Error(failureMessage);
    await new Promise((r) => setTimeout(r, 100));
  }
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
    const nodesBody = (await nodesRes.json()) as {
      nodes: Array<{ url: string; healthy: boolean }>;
      healthyCount: number;
      count: number;
    };
    assert.equal(nodesBody.count, 3);
    assert.equal(nodesBody.healthyCount, 3);
    assert.deepEqual(nodesBody.nodes.map((n) => n.url).sort(), [...NODE_URLS].sort());
    assert.ok(nodesBody.nodes.every((n) => n.healthy));

    const routeRes = await fetch(`${GATEWAY_URL}/cluster/route/${keys[0]}`);
    const routeBody = (await routeRes.json()) as { node: string };
    assert.equal(routeBody.node, router.nodeFor(keys[0]!));

    // Deleting through the gateway removes it from the node it actually lives on.
    await fetch(`${GATEWAY_URL}/delete/${keys[0]}`, { method: "DELETE" });
    const afterDelete = await fetch(`${GATEWAY_URL}/get/${keys[0]}`);
    assert.equal(afterDelete.status, 404);
  });

  it("detects a node going down, routes around it, and detects it coming back", async () => {
    const failoverNodePorts = [8098, 8099] as const;
    const failoverNodeUrls = failoverNodePorts.map((p) => `http://localhost:${p}`);
    const failoverGatewayPort = 8100;
    const failoverGatewayUrl = `http://localhost:${failoverGatewayPort}`;

    const nodeProcs = new Map<string, ChildProcess>();
    for (const port of failoverNodePorts) {
      const proc = spawn(process.execPath, ["--import", "tsx", "src/network/server.ts"], {
        env: { ...process.env, INKCACHE_PORT: String(port), INKCACHE_NODE_ID: `failover-${port}` },
        stdio: "ignore",
      });
      nodeProcs.set(`http://localhost:${port}`, proc);
      procs.push(proc);
    }
    await Promise.all(failoverNodeUrls.map((url) => waitForHealth(url)));

    const gateway = spawn(process.execPath, ["--import", "tsx", "src/network/gateway-server.ts"], {
      env: {
        ...process.env,
        INKCACHE_GATEWAY_PORT: String(failoverGatewayPort),
        INKCACHE_CLUSTER_NODES: failoverNodeUrls.join(","),
        // Fast interval so this test doesn't have to wait the 2s
        // production default to observe a real detection.
        INKCACHE_GATEWAY_HEALTH_INTERVAL: "300",
      },
      stdio: "ignore",
    });
    procs.push(gateway);
    await waitForHealth(failoverGatewayUrl);

    // Find a key that actually hashes to the second node, so killing it
    // is guaranteed to matter for this key -- not relying on luck.
    const router = new ClusterRouter(failoverNodeUrls);
    let targetKey = "";
    for (let i = 0; i < 200; i++) {
      const candidate = `failover-key:${i}`;
      if (router.nodeFor(candidate) === failoverNodeUrls[1]) {
        targetKey = candidate;
        break;
      }
    }
    assert.notEqual(targetKey, "", "no key in the sample hashed to the second node");

    const victim = nodeProcs.get(failoverNodeUrls[1]!)!;
    victim.kill();
    await waitForExit(victim);

    // Poll /cluster/nodes until the health checker notices the kill.
    const start = Date.now();
    let sawUnhealthy = false;
    while (Date.now() - start < 5000) {
      const res = await fetch(`${failoverGatewayUrl}/cluster/nodes`);
      const body = (await res.json()) as {
        nodes: Array<{ url: string; healthy: boolean }>;
        healthyCount: number;
      };
      const victimStatus = body.nodes.find((n) => n.url === failoverNodeUrls[1]);
      if (victimStatus && !victimStatus.healthy && body.healthyCount === 1) {
        sawUnhealthy = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(sawUnhealthy, "gateway never marked the killed node unhealthy");

    // A key that used to hash to the dead node must now route to the
    // survivor instead of 502ing forever.
    const setRes = await fetch(`${failoverGatewayUrl}/set`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: targetKey, value: "rerouted" }),
    });
    assert.equal(setRes.status, 200);
    const survivorRes = await fetch(`${failoverNodeUrls[0]}/get/${targetKey}`);
    assert.equal(survivorRes.status, 200, "the rerouted write did not land on the surviving node");

    // Restart the killed node on the same port and confirm the gateway
    // notices it's back.
    const revived = spawn(process.execPath, ["--import", "tsx", "src/network/server.ts"], {
      env: {
        ...process.env,
        INKCACHE_PORT: String(failoverNodePorts[1]),
        INKCACHE_NODE_ID: "failover-revived",
      },
      stdio: "ignore",
    });
    procs.push(revived);
    await waitForHealth(failoverNodeUrls[1]!);

    const recoverStart = Date.now();
    let sawRecovered = false;
    while (Date.now() - recoverStart < 5000) {
      const res = await fetch(`${failoverGatewayUrl}/cluster/nodes`);
      const body = (await res.json()) as { healthyCount: number };
      if (body.healthyCount === 2) {
        sawRecovered = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(sawRecovered, "gateway never marked the revived node healthy again");
  });

  it("a node discovers itself into a running gateway and deregisters on graceful shutdown", async () => {
    const gatewayPort = 8101;
    const gatewayUrl = `http://localhost:${gatewayPort}`;
    const nodePort = 8102;
    const nodeUrl = `http://localhost:${nodePort}`;

    // Gateway starts with *zero* configured nodes -- proves discovery
    // works from a cold cluster, not just adding to an existing one.
    const gateway = spawn(process.execPath, ["--import", "tsx", "src/network/gateway-server.ts"], {
      env: {
        ...process.env,
        INKCACHE_GATEWAY_PORT: String(gatewayPort),
        INKCACHE_CLUSTER_NODES: "",
      },
      stdio: "ignore",
    });
    procs.push(gateway);
    await waitForHealth(gatewayUrl);

    const node = spawn(process.execPath, ["--import", "tsx", "src/network/server.ts"], {
      env: {
        ...process.env,
        INKCACHE_PORT: String(nodePort),
        INKCACHE_NODE_ID: "self-registering",
        INKCACHE_GATEWAY_URL: gatewayUrl,
        INKCACHE_SELF_URL: nodeUrl,
      },
      stdio: "ignore",
    });
    procs.push(node);
    await waitForHealth(nodeUrl);

    await waitUntilGatewayLists(
      gatewayUrl,
      nodeUrl,
      true,
      "node never self-registered with the gateway",
    );

    // The self-registered node actually serves real traffic once discovered.
    await fetch(`${gatewayUrl}/set`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "discovered-key", value: "hello" }),
    });
    const getRes = await fetch(`${gatewayUrl}/get/discovered-key`);
    assert.equal(getRes.status, 200);

    node.kill("SIGTERM");
    await waitForExit(node);

    // Windows cannot deliver a real, catchable SIGTERM to a child
    // process -- ChildProcess.kill()'s own docs say non-SIGKILL signals
    // are ignored there and the process is just forcefully terminated,
    // same limitation already documented in .github/workflows/ci.yml
    // for the Docker graceful-shutdown smoke test (verified there via a
    // real `docker stop` instead, which *does* deliver a real signal).
    // Confirmed by direct reproduction: sending SIGTERM to a plain
    // server.ts process on this machine kills it without its "received
    // SIGTERM" log line ever printing. shutdown()'s registration logic
    // itself is unit-tested (tests/gateway.test.ts's DELETE
    // /cluster/nodes coverage) and the surrounding shutdown() function
    // is the same one already proven to run correctly under a real
    // POSIX SIGTERM in CI (persistence's final-save-on-shutdown, same
    // handler). On a real POSIX target this assertion holds; on Windows
    // it can't be verified locally, so it's skipped rather than
    // asserted-and-ignored.
    if (process.platform === "win32") {
      return;
    }
    await waitUntilGatewayLists(
      gatewayUrl,
      nodeUrl,
      false,
      "node never deregistered from the gateway on graceful shutdown",
    );
  });

  it("a node registers with multiple gateways at once, closing the single-gateway-SPOF gap", async () => {
    const gateway1Port = 8109;
    const gateway2Port = 8110;
    const gateway1Url = `http://localhost:${gateway1Port}`;
    const gateway2Url = `http://localhost:${gateway2Port}`;
    const nodePort = 8111;
    const nodeUrl = `http://localhost:${nodePort}`;

    // Two independent gateways, neither aware the other exists --
    // exactly the "no gateway-to-gateway coordination" model
    // server.ts's own comment describes.
    const gateway1 = spawn(process.execPath, ["--import", "tsx", "src/network/gateway-server.ts"], {
      env: {
        ...process.env,
        INKCACHE_GATEWAY_PORT: String(gateway1Port),
        INKCACHE_CLUSTER_NODES: "",
      },
      stdio: "ignore",
    });
    procs.push(gateway1);
    const gateway2 = spawn(process.execPath, ["--import", "tsx", "src/network/gateway-server.ts"], {
      env: {
        ...process.env,
        INKCACHE_GATEWAY_PORT: String(gateway2Port),
        INKCACHE_CLUSTER_NODES: "",
      },
      stdio: "ignore",
    });
    procs.push(gateway2);
    await Promise.all([waitForHealth(gateway1Url), waitForHealth(gateway2Url)]);

    const node = spawn(process.execPath, ["--import", "tsx", "src/network/server.ts"], {
      env: {
        ...process.env,
        INKCACHE_PORT: String(nodePort),
        INKCACHE_NODE_ID: "multi-gateway-node",
        INKCACHE_GATEWAY_URL: `${gateway1Url},${gateway2Url}`,
        INKCACHE_SELF_URL: nodeUrl,
      },
      stdio: "ignore",
    });
    procs.push(node);
    await waitForHealth(nodeUrl);

    await waitUntilGatewayLists(gateway1Url, nodeUrl, true, "node never registered with gateway 1");
    await waitUntilGatewayLists(gateway2Url, nodeUrl, true, "node never registered with gateway 2");

    // Both gateways can independently route real traffic to the node.
    const via1 = await fetch(`${gateway1Url}/set`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "via-gw1", value: "x" }),
    });
    assert.equal(via1.status, 200);
    const via2 = await fetch(`${gateway2Url}/get/via-gw1`);
    assert.equal(
      via2.status,
      200,
      "gateway 2 couldn't reach the node registered through gateway 1",
    );
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
