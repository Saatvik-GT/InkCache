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

describe("access-aware eviction", () => {
  it("a hot key survives eviction even at the LRU edge, unlike plain LRU", () => {
    const store = new CacheStore({ maxEntries: 3, evictionSampleSize: 3 });
    store.set("hot", "1");
    store.get("hot");
    store.get("hot");
    store.get("hot"); // 3 reads, but "hot" is still oldest by insertion order
    store.set("b", "2");
    store.set("c", "3");
    // sample window is [hot(hits=3), b(hits=0), c(hits=0)] — plain LRU would
    // evict "hot" outright since it's the least-recently-touched of the three.
    store.set("d", "4");
    assert.equal(store.get("hot"), "1");
    assert.equal(store.get("b"), undefined);
  });

  it("falls back to strict LRU when policy is explicitly 'lru'", () => {
    const store = new CacheStore({ maxEntries: 3, policy: "lru" });
    store.set("hot", "1");
    store.get("hot");
    store.get("hot");
    store.get("hot");
    store.set("b", "2");
    store.set("c", "3");
    store.set("d", "4"); // strict LRU evicts "hot" regardless of hit count
    assert.equal(store.get("hot"), undefined);
    assert.equal(store.get("b"), "2");
  });

  it("evictionSampleSize controls how much frequency can override recency", () => {
    const build = (evictionSampleSize: number) => {
      const store = new CacheStore({ maxEntries: 3, evictionSampleSize });
      store.set("hot", "1");
      store.get("hot");
      store.get("hot");
      store.get("hot");
      store.set("b", "2");
      store.set("c", "3");
      store.set("d", "4");
      return store;
    };
    // sample size 1: only the single oldest key is ever a candidate, so
    // "hot" gets evicted outright — hit count never gets consulted.
    assert.equal(build(1).get("hot"), undefined);
    // sample size 3: "hot" is in the window but isn't the least-accessed
    // member of it, so a colder key is evicted instead.
    assert.equal(build(3).get("hot"), "1");
  });

  it("accessCount() reports reads since last set, undefined once gone", () => {
    const store = new CacheStore();
    store.set("a", "1");
    assert.equal(store.accessCount("a"), 0);
    store.get("a");
    store.get("a");
    assert.equal(store.accessCount("a"), 2);
    store.set("a", "2"); // overwrite resets popularity for the new value
    assert.equal(store.accessCount("a"), 0);
    assert.equal(store.accessCount("nope"), undefined);
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

describe("detailedKeys()", () => {
  it("reports hits and ttl per live key", () => {
    const store = new CacheStore();
    store.set("a", "1");
    store.get("a");
    store.get("a");
    store.set("b", "2", { ttl: 30 });
    const rows = store.detailedKeys().sort((x, y) => x.key.localeCompare(y.key));
    assert.deepEqual(
      rows.map((r) => r.key),
      ["a", "b"],
    );
    assert.equal(rows[0]!.hits, 2);
    assert.equal(rows[0]!.ttl, null);
    assert.ok(rows[1]!.ttl !== null && rows[1]!.ttl > 29 && rows[1]!.ttl <= 30);
  });

  it("excludes and cleans up expired entries", () => {
    mock.timers.enable({ apis: ["Date"] });
    const store = new CacheStore();
    store.set("dead", "x", { ttl: 1 });
    store.set("live", "y");
    mock.timers.tick(1_001);
    const rows = store.detailedKeys();
    assert.deepEqual(
      rows.map((r) => r.key),
      ["live"],
    );
    assert.equal(store.size, 1); // expired entry swept during the pass
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

describe("startSweeper()/stopSweeper()", () => {
  it("automatically reclaims expired entries on the interval", () => {
    mock.timers.enable({ apis: ["Date", "setInterval"] });
    const store = new CacheStore();
    store.set("a", "1", { ttl: 1 });
    store.startSweeper(1000);
    mock.timers.tick(1500); // past both the ttl and one sweep interval
    assert.equal(store.size, 0);
    store.stopSweeper();
    mock.timers.reset();
  });

  it("stopSweeper() is safe to call without a running sweeper", () => {
    const store = new CacheStore();
    assert.doesNotThrow(() => store.stopSweeper());
  });
});
