import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderAsciiSphere, LUMA_RAMP } from "../src/dashboard/src/lib/asciiSphere.js";

/**
 * The sphere renderer is pure math with no DOM, so it's testable here even
 * though it ships in the dashboard — worth doing, because a silent
 * regression in the projection or depth test would just look like "the
 * moon renders a bit wrong" rather than throwing.
 */
describe("renderAsciiSphere()", () => {
  it("emits exactly rows lines of exactly cols characters", () => {
    const lines = renderAsciiSphere({ cols: 40, rows: 18, spin: 0 }).split("\n");
    assert.equal(lines.length, 18);
    for (const line of lines) assert.equal(line.length, 40);
  });

  it("only emits characters from the luminance ramp", () => {
    const out = renderAsciiSphere({ cols: 40, rows: 18, spin: 1.2 });
    for (const ch of out.replace(/\n/g, "")) {
      assert.ok(LUMA_RAMP.includes(ch), `unexpected character ${JSON.stringify(ch)}`);
    }
  });

  it("actually rotates — a different spin renders a different frame", () => {
    const a = renderAsciiSphere({ cols: 40, rows: 18, spin: 0 });
    const b = renderAsciiSphere({ cols: 40, rows: 18, spin: 0.8 });
    assert.notEqual(a, b);
  });

  it("is periodic over a full turn", () => {
    const a = renderAsciiSphere({ cols: 40, rows: 18, spin: 0.3 });
    const b = renderAsciiSphere({ cols: 40, rows: 18, spin: 0.3 + Math.PI * 2 });
    assert.equal(a, b);
  });

  it("projects a round body — the widest row is the equator", () => {
    const rows = 21;
    // ambient:1 floods the whole disc to full brightness, isolating the
    // projection from the lighting. Without it this measures the *lit*
    // extent, whose widest row sits above the equator because the light
    // comes from above — a real property of the render, not a defect.
    const lines = renderAsciiSphere({ cols: 60, rows, spin: 0.5, ambient: 1 }).split("\n");
    const widths = lines.map((l) => l.trim().length);
    const max = Math.max(...widths);
    // Several rows near the equator tie at the max width, so take the
    // midpoint of that plateau rather than its first index.
    const first = widths.indexOf(max);
    const last = widths.lastIndexOf(max);
    const widest = (first + last) / 2;
    assert.ok(
      Math.abs(widest - (rows - 1) / 2) <= 1,
      `widest band centered at ${widest} should be the equator of ${rows}`,
    );
  });

  it("projects a visually round disc once cell proportions are accounted for", () => {
    // Measured at the size the hero actually renders — the cell-rounding
    // error that skews the aspect is resolution-dependent, so checking a
    // toy grid would pass while the real one came out an egg.
    const lines = renderAsciiSphere({ cols: 108, rows: 46, spin: 0.5, ambient: 1 }).split("\n");
    const heightCells = lines.filter((l) => l.trim().length > 0).length;
    const widthCells = Math.max(...lines.map((l) => l.trim().length));
    // A monospace cell is ~0.6em wide by 1em tall, so convert to em before
    // comparing: that ratio is what the eye actually sees.
    const emRatio = (widthCells * 0.6) / heightCells;
    assert.ok(
      Math.abs(emRatio - 1) < 0.04,
      `rendered ${widthCells}x${heightCells} cells = em ratio ${emRatio.toFixed(3)}, want ~1.000`,
    );
  });

  it("leaves the corners empty — a sphere doesn't fill its bounding box", () => {
    const cols = 50;
    const lines = renderAsciiSphere({ cols, rows: 20, spin: 0.5 }).split("\n");
    assert.equal(lines[0]![0], " ");
    assert.equal(lines[0]![cols - 1], " ");
    assert.equal(lines[lines.length - 1]![0], " ");
    assert.equal(lines[lines.length - 1]![cols - 1], " ");
  });
});
