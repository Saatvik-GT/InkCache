import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ClusterRouter } from "../src/network/cluster.js";
import { startHealthChecks } from "../src/network/health-check.js";

/** A /health endpoint whose response can be toggled between healthy and
    down on demand, to drive the checker through a real up -> down -> up
    cycle without needing a real InkCache node process. */
async function startToggleableServer(): Promise<{
  url: string;
  server: http.Server;
  setHealthy: (healthy: boolean) => void;
}> {
  let healthy = true;
  const server = http.createServer((req, res) => {
    if (req.url === "/health" && healthy) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else {
      res.destroy();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server, setHealthy: (h) => (healthy = h) };
}

async function waitUntil(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("condition never became true");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("startHealthChecks()", () => {
  const servers: http.Server[] = [];
  after(() => {
    for (const s of servers) s.close();
  });

  it("keeps every node in the router while all are healthy", async () => {
    const a = await startToggleableServer();
    const b = await startToggleableServer();
    servers.push(a.server, b.server);

    const router = new ClusterRouter([a.url, b.url]);
    const handle = startHealthChecks(router, [a.url, b.url], 30, 200);
    try {
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(router.size, 2);
      assert.ok(handle.status().every((n) => n.healthy));
    } finally {
      handle.stop();
    }
  });

  it("removes a node from the router once it stops answering /health", async () => {
    const a = await startToggleableServer();
    const b = await startToggleableServer();
    servers.push(a.server, b.server);

    const router = new ClusterRouter([a.url, b.url]);
    const handle = startHealthChecks(router, [a.url, b.url], 30, 200);
    try {
      b.setHealthy(false);
      await waitUntil(() => router.size === 1);
      assert.deepEqual(router.nodes, [a.url]);
      const status = handle.status();
      assert.equal(status.find((n) => n.url === b.url)?.healthy, false);
      assert.equal(status.find((n) => n.url === a.url)?.healthy, true);
    } finally {
      handle.stop();
    }
  });

  it("adds a node back once it starts answering /health again", async () => {
    const a = await startToggleableServer();
    const b = await startToggleableServer();
    servers.push(a.server, b.server);
    b.setHealthy(false);

    const router = new ClusterRouter([a.url, b.url]);
    const handle = startHealthChecks(router, [a.url, b.url], 30, 200);
    try {
      await waitUntil(() => router.size === 1);
      b.setHealthy(true);
      await waitUntil(() => router.size === 2);
      assert.deepEqual(router.nodes.sort(), [a.url, b.url].sort());
    } finally {
      handle.stop();
    }
  });

  it("stop() halts further checks -- a node going down afterward is not detected", async () => {
    const a = await startToggleableServer();
    servers.push(a.server);

    const router = new ClusterRouter([a.url]);
    const handle = startHealthChecks(router, [a.url], 30, 200);
    handle.stop();

    a.setHealthy(false);
    await new Promise((r) => setTimeout(r, 150));
    // No check ran after stop(), so the router still thinks it's healthy.
    assert.equal(router.size, 1);
  });

  it("every node starts assumed healthy before the first check runs", () => {
    const router = new ClusterRouter(["http://a", "http://b"]);
    const handle = startHealthChecks(router, ["http://a", "http://b"], 60_000, 1000);
    try {
      assert.ok(handle.status().every((n) => n.healthy));
    } finally {
      handle.stop();
    }
  });
});
