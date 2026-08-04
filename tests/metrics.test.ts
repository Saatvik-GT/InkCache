import { describe, it, mock } from "node:test";
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
    // Nearest-rank p95 of 1..100 is the 95th-smallest value: 95, not 96
    // (100 * 0.95 = 95 is already an integer -- the exact case the
    // previous Math.floor formula got wrong, picking index 95 instead of
    // the correct rank-95 index 94).
    assert.equal(snap.latency.p95Us, 95);
  });

  it("picks the 95th-smallest value, not the max, when N is a multiple of 20", () => {
    const m = new MetricsCollector();
    for (let i = 1; i <= 20; i++) m.record("get", i, true);
    // Regression test for the off-by-one: N=20 is exactly the boundary
    // where floor(20 * 0.95) === 19 (the max) instead of the correct
    // rank-19 index 18 (value 19).
    assert.equal(m.snapshot().latency.p95Us, 19);
  });

  it("computes avg and p95 correctly from a single sample", () => {
    const m = new MetricsCollector();
    m.record("get", 42, true);
    const snap = m.snapshot();
    assert.equal(snap.latency.avgUs, 42);
    assert.equal(snap.latency.p95Us, 42);
    assert.equal(snap.latency.samples, 1);
  });

  it("rounds avgUs to exactly 2 decimal places", () => {
    const m = new MetricsCollector();
    m.record("get", 1, true);
    m.record("get", 2, true);
    m.record("get", 4, true); // avg = 7/3 = 2.3333... -> should round to 2.33
    assert.equal(m.snapshot().latency.avgUs, 2.33);
  });

  it("caps latency samples at the ring buffer size instead of growing forever", () => {
    const m = new MetricsCollector();
    // One more than the 512-slot ring buffer; the last one should have
    // overwritten the oldest slot rather than the array just growing to 600.
    for (let i = 1; i <= 600; i++) m.record("get", i, true);
    const snap = m.snapshot();
    assert.equal(snap.latency.samples, 512);
  });

  it("opsPerSec is a rolling 10s window, not a lifetime average", () => {
    mock.timers.enable({ apis: ["Date"] });
    try {
      const m = new MetricsCollector();
      m.record("get", 10, true);
      m.record("get", 10, true);
      assert.equal(m.snapshot().opsPerSec, 0.2); // 2 ops / 10s window

      mock.timers.tick(11_000); // past the window — those two ops age out
      assert.equal(m.snapshot().opsPerSec, 0);

      m.record("set", 5);
      assert.equal(m.snapshot().opsPerSec, 0.1); // only the new op counts
    } finally {
      mock.timers.reset();
    }
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
