import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderMeter } from "../src/dashboard/src/lib/asciiChart.js";

describe("renderMeter()", () => {
  it("renders a full-width track at every ratio", () => {
    for (const r of [0, 0.25, 0.5, 1]) {
      assert.equal(renderMeter(r, 20).length, 20, `width wrong at ratio ${r}`);
    }
  });

  it("is empty at 0 and full at 1", () => {
    assert.equal(renderMeter(0, 8), "░░░░░░░░");
    assert.equal(renderMeter(1, 8), "████████");
  });

  it("clamps out-of-range and non-finite ratios instead of overflowing", () => {
    assert.equal(renderMeter(5, 6), "██████");
    assert.equal(renderMeter(-2, 6), "░░░░░░");
    assert.equal(renderMeter(NaN, 6), "░░░░░░");
  });
});
