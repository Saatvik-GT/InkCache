import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { CacheStore } from "../src/core/cache.js";
import {
  applyReplicationOp,
  forwardToReplicas,
  resolveReplicaUrls,
  syncFromPrimary,
  type ReplicationOp,
} from "../src/network/replication.js";

/** Polls until `check()` is true, instead of a fixed sleep -- a fixed
    100ms wait was flaky under load (e.g. the full suite running many
    concurrent processes): forwardToReplicas() is genuinely
    fire-and-forget, so a request from one test could still be in
    flight past its own 100ms window and land during a *later* test's
    window instead, after that test had already reset its own
    `received` array, corrupting its count. Caught live via a failure
    that only reproduced running the full suite, never in isolation. */
async function waitUntil(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("condition never became true");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("resolveReplicaUrls()", () => {
  it("returns an empty array when unset", () => {
    assert.deepEqual(resolveReplicaUrls(undefined), []);
  });

  it("returns an empty array for an empty string", () => {
    assert.deepEqual(resolveReplicaUrls(""), []);
  });

  it("splits multiple comma-separated urls and trims whitespace", () => {
    assert.deepEqual(resolveReplicaUrls(" http://a:8080 , http://b:8081 "), [
      "http://a:8080",
      "http://b:8081",
    ]);
  });

  it("drops a trailing slash so url + /internal/replicate never double-slashes", () => {
    assert.deepEqual(resolveReplicaUrls("http://a:8080/"), ["http://a:8080"]);
  });

  it("drops blank entries from stray/trailing commas", () => {
    assert.deepEqual(resolveReplicaUrls("http://a:8080,,"), ["http://a:8080"]);
  });
});

describe("applyReplicationOp()", () => {
  it("applies a set op", () => {
    const store = new CacheStore();
    applyReplicationOp(store, { op: "set", key: "k", value: "v", ttl: 30 });
    assert.equal(store.get("k"), "v");
    assert.ok((store.ttl("k") ?? 0) > 0);
  });

  it("applies a delete op", () => {
    const store = new CacheStore();
    store.set("k", "v");
    applyReplicationOp(store, { op: "delete", key: "k" });
    assert.equal(store.get("k"), undefined);
  });

  it("applies an invalidate op", () => {
    const store = new CacheStore();
    store.set("user:1", "a");
    store.set("user:2", "b");
    store.set("other", "c");
    applyReplicationOp(store, { op: "invalidate", prefix: "user:" });
    assert.deepEqual(store.keys().sort(), ["other"]);
  });

  it("applies a flush op", () => {
    const store = new CacheStore();
    store.set("a", "1");
    store.set("b", "2");
    applyReplicationOp(store, { op: "flush" });
    assert.equal(store.size, 0);
  });
});

/** A fresh capture server per test, not one shared across the whole
    describe block via before()/after() -- forwardToReplicas() is
    genuinely fire-and-forget, so a shared server meant a slow request
    from one test could still be in flight past that test's own
    assertion and land during a *later* test's window on the same
    server, corrupting its `received` count no matter how that later
    test waited for its own requests to land. A closed-per-test server
    makes that structurally impossible: a straggler from a previous
    test targets a port nothing is listening on anymore. */
async function startCaptureServer(): Promise<{
  baseUrl: string;
  received: Array<{ url: string; body: unknown }>;
  close: () => void;
}> {
  const received: Array<{ url: string; body: unknown }> = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk));
    req.on("end", () => {
      received.push({ url: req.url ?? "", body: JSON.parse(raw) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, received, close: () => server.close() };
}

describe("forwardToReplicas()", () => {
  it("posts the op to /internal/replicate on every configured replica", async () => {
    const { baseUrl, received, close } = await startCaptureServer();
    try {
      const op: ReplicationOp = { op: "set", key: "k", value: "v" };
      forwardToReplicas([baseUrl], op);
      await waitUntil(() => received.length >= 1);
      assert.equal(received.length, 1);
      assert.equal(received[0]!.url, "/internal/replicate");
      assert.deepEqual(received[0]!.body, op);
    } finally {
      close();
    }
  });

  it("fans out to every replica in the list", async () => {
    const { baseUrl, received, close } = await startCaptureServer();
    try {
      forwardToReplicas([baseUrl, baseUrl], { op: "flush" });
      await waitUntil(() => received.length >= 2);
      assert.equal(received.length, 2);
    } finally {
      close();
    }
  });

  it("does not throw when a replica is unreachable", () => {
    assert.doesNotThrow(() => {
      forwardToReplicas(["http://127.0.0.1:1"], { op: "delete", key: "k" });
    });
  });
});

describe("syncFromPrimary()", () => {
  it("loads every key from the primary's /snapshot into the local store", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/snapshot") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            keys: [
              { key: "a", value: "1", ttl: null },
              { key: "b", value: "2", ttl: 30 },
            ],
            count: 2,
          }),
        );
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    const store = new CacheStore();
    const loaded = await syncFromPrimary(store, `http://127.0.0.1:${port}`);
    assert.equal(loaded, 2);
    assert.equal(store.get("a"), "1");
    assert.equal(store.get("b"), "2");
    assert.ok((store.ttl("b") ?? 0) > 0);
    assert.equal(store.ttl("a"), undefined);

    server.close();
  });

  it("retries then gives up (returning 0) when the primary never answers", async () => {
    const store = new CacheStore();
    const loaded = await syncFromPrimary(store, "http://127.0.0.1:1", 2, 10);
    assert.equal(loaded, 0);
    assert.equal(store.size, 0);
  });

  it("succeeds on a later attempt after earlier ones fail", async () => {
    let attempts = 0;
    const server = http.createServer((req, res) => {
      attempts++;
      if (attempts < 2) {
        req.destroy();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [{ key: "a", value: "1", ttl: null }], count: 1 }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    const store = new CacheStore();
    const loaded = await syncFromPrimary(store, `http://127.0.0.1:${port}`, 5, 10);
    assert.equal(loaded, 1);
    assert.equal(store.get("a"), "1");

    server.close();
  });
});
