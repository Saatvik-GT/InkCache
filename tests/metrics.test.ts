import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MetricsCollector } from "../src/core/metrics.js";

describe("MetricsCollector", () => {
  it("tracks hits, misses and hit rate", () => {
    const m = new MetricsCollector();
    m.record("get", 10, true);
    m.record("get", 10, true);
    m.record("get", 10, false);
    const snap = m.snapshot();
    assert.equal(snap.hits, 2);
    assert.equal(snap.misses, 1);
    assert.equal(snap.hitRate, 2 / 3);
  });

  it("reports null hit rate before any read", () => {
    const m = new MetricsCollector();
    m.record("set", 5);
    assert.equal(m.snapshot().hitRate, null);
  });

  it("computes average and p95 latency from recorded samples", () => {
    const m = new MetricsCollector();
    for (let i = 1; i <= 100; i++) m.record("get", i, true);
    const snap = m.snapshot();
    assert.equal(snap.latency.samples, 100);
    assert.ok(snap.latency.avgUs !== null && Math.abs(snap.latency.avgUs - 50.5) < 0.5);
    assert.equal(snap.latency.p95Us, 96);
  });

  it("reports a small positive uptimeSec right after construction", () => {
    const m = new MetricsCollector();
    assert.ok(m.uptimeSec >= 0 && m.uptimeSec < 1);
  });

  it("counts sets and deletes independently of get hit/miss", () => {
    const m = new MetricsCollector();
    m.record("set", 1);
    m.record("set", 1);
    m.record("delete", 1);
    const snap = m.snapshot();
    assert.equal(snap.sets, 2);
    assert.equal(snap.deletes, 1);
    assert.equal(snap.hits + snap.misses, 0);
  });
});
