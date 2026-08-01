import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { skewedKey } from "../src/dashboard/src/lib/skewedKey.js";

const POOL = 64;

describe("skewedKey()", () => {
  it("always returns a key within the pool range", () => {
    for (let i = 0; i < 500; i++) {
      const key = skewedKey();
      const match = key.match(/^sim:user:(\d+)$/);
      assert.ok(match, `unexpected key shape: ${key}`);
      const idx = Number(match![1]);
      assert.ok(idx >= 0 && idx < POOL, `index ${idx} out of range 0..${POOL}`);
    }
  });

  it("is power-law skewed toward low indices, not uniform", () => {
    // Uniform over [0, POOL) would put ~10% of draws in the bottom decile.
    // The actual skew (power 2.4) puts roughly 40% there — sampled and
    // asserted with a generous threshold since this is genuine randomness,
    // not a fixed sequence.
    const n = 5000;
    let inBottomDecile = 0;
    for (let i = 0; i < n; i++) {
      const idx = Number(skewedKey().split(":")[2]);
      if (idx < POOL * 0.1) inBottomDecile++;
    }
    const share = inBottomDecile / n;
    assert.ok(
      share > 0.25,
      `bottom decile share was ${(share * 100).toFixed(1)}% — expected clear skew (>25%), not uniform (~10%)`,
    );
  });
});
