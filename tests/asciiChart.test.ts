import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderMeter, renderSparkline, SPARK_LEVELS } from "../src/dashboard/src/lib/asciiChart.js";

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

describe("renderSparkline()", () => {
  it("renders one character per value", () => {
    assert.equal(renderSparkline([1, 2, 3, 4]).length, 4);
  });

  it("maps the lowest value to the floor and the highest to the ceiling", () => {
    const out = renderSparkline([0, 100]);
    assert.equal(out[0], SPARK_LEVELS[0]);
    assert.equal(out[1], SPARK_LEVELS[SPARK_LEVELS.length - 1]);
  });

  it("keeps a gap for null rather than interpolating across it", () => {
    assert.equal(renderSparkline([1, null, 5])[1], " ");
  });

  it("renders a flat series mid-ramp instead of dividing by zero", () => {
    const out = renderSparkline([7, 7, 7]);
    assert.equal(out, SPARK_LEVELS[4]!.repeat(3));
  });

  it("renders all-null input as blanks of the right length", () => {
    assert.equal(renderSparkline([null, null, null]), "   ");
  });
});
