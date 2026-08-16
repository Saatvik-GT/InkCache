import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HashRing } from "../src/core/hashring.js";

describe("HashRing basics", () => {
  it("returns undefined for any key on an empty ring", () => {
    const ring = new HashRing();
    assert.equal(ring.getNode("k"), undefined);
  });

  it("routes every key to the sole node on a single-node ring", () => {
    const ring = new HashRing(["a"]);
    for (const key of ["x", "y", "z", "user:1", ""]) {
      assert.equal(ring.getNode(key), "a");
    }
  });

  it("is deterministic -- the same key on an unchanged ring always maps to the same node", () => {
    const ring = new HashRing(["a", "b", "c"]);
    const first = ring.getNode("some-key");
    for (let i = 0; i < 20; i++) {
      assert.equal(ring.getNode("some-key"), first);
    }
  });

  it("exposes the current node set and size", () => {
    const ring = new HashRing(["a", "b"]);
    assert.deepEqual(ring.nodes.sort(), ["a", "b"]);
    assert.equal(ring.size, 2);
  });

  it("adding an already-present node is a no-op, not a duplicate", () => {
    const ring = new HashRing(["a"]);
    ring.add("a");
    assert.equal(ring.size, 1);
    assert.deepEqual(ring.nodes, ["a"]);
  });

  it("removing an absent node is a no-op", () => {
    const ring = new HashRing(["a"]);
    ring.remove("nonexistent");
    assert.equal(ring.size, 1);
  });

  it("removing every node returns the ring to empty", () => {
    const ring = new HashRing(["a", "b"]);
    ring.remove("a");
    ring.remove("b");
    assert.equal(ring.size, 0);
    assert.equal(ring.getNode("k"), undefined);
  });
});

describe("HashRing distribution", () => {
  function keys(n: number): string[] {
    return Array.from({ length: n }, (_, i) => `key:${i}`);
  }

  it("spreads a large key set roughly evenly across nodes", () => {
    const ring = new HashRing(["a", "b", "c", "d"]);
    const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    for (const key of keys(20_000)) {
      counts[ring.getNode(key)!]!++;
    }
    // Perfectly even would be 5000 each; with 150 virtual nodes per
    // physical node the real-world spread for libketama-style rings is
    // within a few percent -- ±25% is a generous bound that would still
    // catch a genuinely broken distribution (e.g. one node getting 90%).
    for (const node of ["a", "b", "c", "d"]) {
      assert.ok(
        counts[node]! > 3750 && counts[node]! < 6250,
        `node ${node} got ${counts[node]} of 20000 keys, expected roughly 5000`,
      );
    }
  });

  it("more virtual nodes per physical node improves evenness", () => {
    function spreadVariance(virtualNodes: number): number {
      const ring = new HashRing(["a", "b", "c"], { virtualNodes });
      const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
      for (const key of keys(9000)) counts[ring.getNode(key)!]!++;
      const mean = 3000;
      return Object.values(counts).reduce((s, c) => s + (c - mean) ** 2, 0) / 3;
    }
    // A handful of virtual points per node is much lumpier than the
    // library default -- this is the actual reason virtual nodes exist,
    // not just a config knob nobody would notice removing.
    assert.ok(spreadVariance(3) > spreadVariance(150));
  });
});

describe("HashRing minimal disruption", () => {
  it("removing a node only remaps the keys that were on it, not the whole keyspace", () => {
    const ring = new HashRing(["a", "b", "c", "d"]);
    const before = new Map<string, string>();
    for (let i = 0; i < 5000; i++) {
      const key = `key:${i}`;
      before.set(key, ring.getNode(key)!);
    }

    ring.remove("b");

    let remapped = 0;
    let remappedOffB = 0;
    for (const [key, prevNode] of before) {
      const nowNode = ring.getNode(key)!;
      if (nowNode !== prevNode) {
        remapped++;
        if (prevNode !== "b") remappedOffB++;
      }
    }
    // Every remapped key must have come from the removed node -- a key
    // that was on "a", "c", or "d" has no reason to move.
    assert.equal(remappedOffB, 0);
    // Roughly a quarter of keys (b's share of 4 nodes) should move --
    // a wide but meaningful bound: anything near 0 or near 5000 would
    // mean removal isn't actually behaving like consistent hashing.
    assert.ok(remapped > 800 && remapped < 1700, `${remapped} of 5000 keys remapped`);
  });

  it("adding a node only steals keys for the new node, not reshuffle everyone else", () => {
    const ring = new HashRing(["a", "b", "c"]);
    const before = new Map<string, string>();
    for (let i = 0; i < 5000; i++) {
      const key = `key:${i}`;
      before.set(key, ring.getNode(key)!);
    }

    ring.add("d");

    for (const [key, prevNode] of before) {
      const nowNode = ring.getNode(key)!;
      // A key can only move to the newly-added node -- it can never move
      // from one pre-existing node to a different pre-existing one.
      if (nowNode !== prevNode) {
        assert.equal(nowNode, "d");
      }
    }
  });
});
