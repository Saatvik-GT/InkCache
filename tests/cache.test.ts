import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { CacheStore } from "../src/core/cache.js";

describe("CacheStore basics", () => {
  it("stores and retrieves values", () => {
    const store = new CacheStore();
    store.set("a", "1");
    assert.equal(store.get("a"), "1");
    assert.equal(store.size, 1);
  });

  it("returns undefined for missing keys", () => {
    const store = new CacheStore();
    assert.equal(store.get("nope"), undefined);
  });

  it("deletes keys and reports whether one was removed", () => {
    const store = new CacheStore();
    store.set("a", "1");
    assert.equal(store.delete("a"), true);
    assert.equal(store.delete("a"), false);
    assert.equal(store.get("a"), undefined);
  });

  it("overwrites an existing key", () => {
    const store = new CacheStore();
    store.set("a", "1");
    store.set("a", "2");
    assert.equal(store.get("a"), "2");
    assert.equal(store.size, 1);
  });
});

describe("TTL expiry", () => {
  it("expires entries lazily on read", () => {
    mock.timers.enable({ apis: ["Date"] });
    const store = new CacheStore();
    store.set("a", "1", { ttl: 10 });
    assert.equal(store.get("a"), "1");
    mock.timers.tick(10_001);
    assert.equal(store.get("a"), undefined);
    mock.timers.reset();
  });

  it("sweep() drops only expired entries", () => {
    mock.timers.enable({ apis: ["Date"] });
    const store = new CacheStore();
    store.set("short", "x", { ttl: 5 });
    store.set("long", "y", { ttl: 60 });
    store.set("forever", "z");
    mock.timers.tick(5_001);
    assert.equal(store.sweep(), 1);
    assert.equal(store.get("long"), "y");
    assert.equal(store.get("forever"), "z");
    mock.timers.reset();
  });

  it("reports remaining ttl and none for persistent keys", () => {
    const store = new CacheStore();
    store.set("t", "x", { ttl: 30 });
    store.set("p", "y");
    const remaining = store.ttl("t");
    assert.ok(remaining !== undefined && remaining > 29 && remaining <= 30);
    assert.equal(store.ttl("p"), undefined);
  });
});

describe("LRU eviction", () => {
  it("evicts the least recently used key at capacity", () => {
    const evicted: string[] = [];
    const store = new CacheStore({ maxEntries: 3, onEvict: (k) => evicted.push(k) });
    store.set("a", "1");
    store.set("b", "2");
    store.set("c", "3");
    store.get("a"); // a is now most recent; b is LRU
    store.set("d", "4");
    assert.deepEqual(evicted, ["b"]);
    assert.equal(store.get("b"), undefined);
    assert.equal(store.get("a"), "1");
    assert.equal(store.evictions, 1);
  });

  it("overwriting refreshes recency", () => {
    const store = new CacheStore({ maxEntries: 3 });
    store.set("a", "1");
    store.set("b", "2");
    store.set("c", "3");
    store.set("a", "1b"); // touch a; b becomes LRU
    store.set("d", "4");
    assert.equal(store.get("b"), undefined);
    assert.equal(store.get("a"), "1b");
  });

  it("prefers reclaiming expired entries over evicting live ones", () => {
    mock.timers.enable({ apis: ["Date"] });
    const store = new CacheStore({ maxEntries: 2 });
    store.set("dead", "x", { ttl: 1 });
    store.set("live", "y");
    mock.timers.tick(1_001);
    store.set("new", "z"); // capacity hit: expired "dead" should go, not "live"
    assert.equal(store.get("live"), "y");
    assert.equal(store.get("new"), "z");
    assert.equal(store.evictions, 0);
    mock.timers.reset();
  });
});

describe("has() and keys()", () => {
  it("has() reports false for an expired key without throwing", () => {
    mock.timers.enable({ apis: ["Date"] });
    const store = new CacheStore();
    store.set("a", "1", { ttl: 5 });
    assert.equal(store.has("a"), true);
    mock.timers.tick(5_001);
    assert.equal(store.has("a"), false);
    mock.timers.reset();
  });

  it("keys() excludes expired entries even before a sweep runs", () => {
    mock.timers.enable({ apis: ["Date"] });
    const store = new CacheStore();
    store.set("live", "y");
    store.set("dead", "x", { ttl: 1 });
    mock.timers.tick(1_001);
    assert.deepEqual(store.keys(), ["live"]);
    mock.timers.reset();
  });
});

describe("clear()", () => {
  it("empties the store and resets size to zero", () => {
    const store = new CacheStore();
    store.set("a", "1");
    store.set("b", "2");
    store.clear();
    assert.equal(store.size, 0);
    assert.equal(store.get("a"), undefined);
  });
});
