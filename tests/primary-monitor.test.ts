import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { startPrimaryMonitor } from "../src/network/primary-monitor.js";

/** Same toggleable /health double as health-check.test.ts's -- lets a
    test drive the monitor through a real up -> down -> up cycle
    without a real InkCache node process. */
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

describe("startPrimaryMonitor()", () => {
  const servers: http.Server[] = [];
  after(() => {
    for (const s of servers) s.close();
  });

  it("reports the primary healthy with zero failures before any check has failed", async () => {
    const primary = await startToggleableServer();
    servers.push(primary.server);
    const handle = startPrimaryMonitor(primary.url, 30, 200);
    try {
      assert.equal(handle.isPrimaryHealthy(), true);
      assert.equal(handle.consecutiveFailures(), 0);
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(handle.isPrimaryHealthy(), true);
    } finally {
      handle.stop();
    }
  });

  it("reports unhealthy and counts consecutive failures once the primary stops answering", async () => {
    const primary = await startToggleableServer();
    servers.push(primary.server);
    primary.setHealthy(false);
    const handle = startPrimaryMonitor(primary.url, 30, 200);
    try {
      await waitUntil(() => handle.consecutiveFailures() >= 3);
      assert.equal(handle.isPrimaryHealthy(), false);
      assert.ok(handle.consecutiveFailures() >= 3);
    } finally {
      handle.stop();
    }
  });

  it("resets the failure streak the instant the primary answers again", async () => {
    const primary = await startToggleableServer();
    servers.push(primary.server);
    primary.setHealthy(false);
    const handle = startPrimaryMonitor(primary.url, 30, 200);
    try {
      await waitUntil(() => handle.consecutiveFailures() >= 2);
      primary.setHealthy(true);
      await waitUntil(() => handle.isPrimaryHealthy());
      assert.equal(handle.consecutiveFailures(), 0);
    } finally {
      handle.stop();
    }
  });

  it("stop() halts further checks -- a primary going down afterward is not detected", async () => {
    const primary = await startToggleableServer();
    servers.push(primary.server);
    const handle = startPrimaryMonitor(primary.url, 30, 200);
    handle.stop();

    primary.setHealthy(false);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(handle.isPrimaryHealthy(), true);
    assert.equal(handle.consecutiveFailures(), 0);
  });

  it("calls onFailure with the running streak after every failed check, and not at all while healthy", async () => {
    const primary = await startToggleableServer();
    servers.push(primary.server);
    const streaks: number[] = [];
    primary.setHealthy(false);
    const handle = startPrimaryMonitor(primary.url, 30, 200, (n) => streaks.push(n));
    try {
      await waitUntil(() => streaks.length >= 3);
      assert.deepEqual(streaks.slice(0, 3), [1, 2, 3]);
    } finally {
      handle.stop();
    }
  });

  it("does not call onFailure once the primary recovers", async () => {
    const primary = await startToggleableServer();
    servers.push(primary.server);
    const streaks: number[] = [];
    primary.setHealthy(false);
    const handle = startPrimaryMonitor(primary.url, 30, 200, (n) => streaks.push(n));
    try {
      await waitUntil(() => streaks.length >= 2);
      const countAtRecovery = streaks.length;
      primary.setHealthy(true);
      await waitUntil(() => handle.isPrimaryHealthy());
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(streaks.length, countAtRecovery);
    } finally {
      handle.stop();
    }
  });
});
