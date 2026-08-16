import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { startGatewaySync } from "../src/network/gateway-sync.js";

/** A minimal peer double: on POST /cluster/sync, records whatever node
    list it was sent and replies with a fixed node list of its own --
    real ElectionState-style merge logic lives in gateway.ts's own
    route (covered by API tests in a later commit); this only needs to
    exercise the network round-trip shape. */
async function startPeer(
  respondWith: string[],
): Promise<{ url: string; server: http.Server; received: string[][] }> {
  const received: string[][] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk));
    req.on("end", () => {
      if (req.url === "/cluster/sync") {
        const body = raw ? (JSON.parse(raw) as { nodes?: string[] }) : {};
        received.push(body.nodes ?? []);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ nodes: respondWith }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server, received };
}

async function waitUntil(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("condition never became true");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("startGatewaySync()", () => {
  const servers: http.Server[] = [];
  after(() => {
    for (const s of servers) s.close();
  });

  it("pushes its own known node list to every peer", async () => {
    const peer = await startPeer([]);
    servers.push(peer.server);
    const handle = startGatewaySync(
      [peer.url],
      () => ["http://node-a:8080", "http://node-b:8080"],
      () => {},
      30,
    );
    try {
      await waitUntil(() => peer.received.length >= 1);
      assert.deepEqual(peer.received[0]!.sort(), ["http://node-a:8080", "http://node-b:8080"]);
    } finally {
      handle.stop();
    }
  });

  it("merges the peer's response back in via onReceiveNodes", async () => {
    const peer = await startPeer(["http://node-from-peer:8080"]);
    servers.push(peer.server);
    const received: string[][] = [];
    const handle = startGatewaySync(
      [peer.url],
      () => [],
      (nodes) => received.push([...nodes]),
      30,
    );
    try {
      await waitUntil(() => received.length >= 1);
      assert.deepEqual(received[0], ["http://node-from-peer:8080"]);
    } finally {
      handle.stop();
    }
  });

  it("syncs with multiple peers independently", async () => {
    const peerA = await startPeer([]);
    const peerB = await startPeer([]);
    servers.push(peerA.server, peerB.server);
    const handle = startGatewaySync(
      [peerA.url, peerB.url],
      () => ["http://shared:8080"],
      () => {},
      30,
    );
    try {
      await waitUntil(() => peerA.received.length >= 1 && peerB.received.length >= 1);
    } finally {
      handle.stop();
    }
  });

  it("does not throw and keeps syncing with reachable peers when one peer is unreachable", async () => {
    const reachable = await startPeer([]);
    servers.push(reachable.server);
    const handle = startGatewaySync(
      [reachable.url, "http://127.0.0.1:1"],
      () => ["http://node-a:8080"],
      () => {},
      30,
      undefined,
      200,
    );
    try {
      await waitUntil(() => reachable.received.length >= 1);
    } finally {
      handle.stop();
    }
  });

  it("stop() halts further sync ticks", async () => {
    const peer = await startPeer([]);
    servers.push(peer.server);
    const handle = startGatewaySync(
      [peer.url],
      () => ["http://node-a:8080"],
      () => {},
      30,
    );
    await waitUntil(() => peer.received.length >= 1);
    handle.stop();
    const countAtStop = peer.received.length;
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(peer.received.length, countAtStop);
  });
});
