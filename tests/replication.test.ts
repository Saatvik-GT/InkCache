import { describe, it, after, before } from "node:test";
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

describe("forwardToReplicas()", () => {
  let received: Array<{ url: string; body: unknown }> = [];
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    server = http.createServer((req, res) => {
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
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(() => {
    server.close();
  });

  it("posts the op to /internal/replicate on every configured replica", async () => {
    received = [];
    const op: ReplicationOp = { op: "set", key: "k", value: "v" };
    forwardToReplicas([baseUrl], op);
    // fire-and-forget: give the in-flight fetch a tick to land.
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(received.length, 1);
    assert.equal(received[0]!.url, "/internal/replicate");
    assert.deepEqual(received[0]!.body, op);
  });

  it("fans out to every replica in the list", async () => {
    received = [];
    forwardToReplicas([baseUrl, baseUrl], { op: "flush" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(received.length, 2);
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
