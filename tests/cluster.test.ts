import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ClusterRouter, resolveClusterNodes } from "../src/network/cluster.js";

describe("resolveClusterNodes()", () => {
  it("returns an empty array when unset", () => {
    assert.deepEqual(resolveClusterNodes(undefined), []);
  });

  it("returns an empty array for an empty string", () => {
    assert.deepEqual(resolveClusterNodes(""), []);
  });

  it("splits multiple comma-separated urls and trims whitespace", () => {
    assert.deepEqual(resolveClusterNodes(" http://a:8080 , http://b:8081 "), [
      "http://a:8080",
      "http://b:8081",
    ]);
  });

  it("drops a trailing slash", () => {
    assert.deepEqual(resolveClusterNodes("http://a:8080/"), ["http://a:8080"]);
  });

  it("drops blank entries from stray/trailing commas", () => {
    assert.deepEqual(resolveClusterNodes("http://a:8080,,"), ["http://a:8080"]);
  });
});

describe("ClusterRouter", () => {
  it("returns undefined for any key with no nodes configured", () => {
    const router = new ClusterRouter();
    assert.equal(router.nodeFor("k"), undefined);
  });

  it("routes to the sole configured node", () => {
    const router = new ClusterRouter(["http://a:8080"]);
    assert.equal(router.nodeFor("anything"), "http://a:8080");
  });

  it("is deterministic for an unchanged node set", () => {
    const router = new ClusterRouter(["http://a:8080", "http://b:8080", "http://c:8080"]);
    const first = router.nodeFor("user:42");
    for (let i = 0; i < 10; i++) {
      assert.equal(router.nodeFor("user:42"), first);
    }
  });

  it("addNode/removeNode update routing and the exposed node list", () => {
    const router = new ClusterRouter(["http://a:8080"]);
    assert.deepEqual(router.nodes, ["http://a:8080"]);
    router.addNode("http://b:8080");
    assert.equal(router.size, 2);
    assert.deepEqual(router.nodes.sort(), ["http://a:8080", "http://b:8080"]);
    router.removeNode("http://a:8080");
    assert.deepEqual(router.nodes, ["http://b:8080"]);
    assert.equal(router.nodeFor("anything"), "http://b:8080");
  });

  it("spreads keys across every configured node", () => {
    const router = new ClusterRouter(["http://a", "http://b", "http://c"]);
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(router.nodeFor(`key:${i}`)!);
    assert.deepEqual([...seen].sort(), ["http://a", "http://b", "http://c"]);
  });
});
