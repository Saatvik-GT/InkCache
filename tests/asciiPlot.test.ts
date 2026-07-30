import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  plotSeries,
  renderBarChart,
  axisTicks,
  PLOT_DOT,
} from "../src/dashboard/src/lib/asciiPlot.js";

describe("plotSeries()", () => {
  it("honours a custom dot glyph", () => {
    const out = plotSeries([5, 5], { cols: 4, rows: 2, dot: "*" }).text;
    assert.ok(out.includes("*"), "the custom dot glyph should appear in the output");
    assert.ok(!out.includes(PLOT_DOT), "the default dot glyph should not appear");
  });

  it("renders exactly rows x cols", () => {
    const lines = plotSeries([1, 5, 3, 8], { cols: 30, rows: 8 }).text.split("\n");
    assert.equal(lines.length, 8);
    for (const l of lines) assert.equal(l.length, 30);
  });

  it("puts the maximum at the top row and the minimum at the bottom", () => {
    const lines = plotSeries([0, 10], { cols: 12, rows: 6 }).text.split("\n");
    assert.ok(lines[0]!.includes(PLOT_DOT), "max should touch the top row");
    assert.ok(lines[5]!.includes(PLOT_DOT), "min should touch the bottom row");
  });

  it("survives a flat series instead of dividing by zero", () => {
    const out = plotSeries([4, 4, 4], { cols: 10, rows: 4 });
    assert.equal(out.text.split("\n").length, 4);
    assert.ok(out.max > out.min, "a flat series still needs a drawable range");
  });

  it("breaks the trace at a null rather than bridging it", () => {
    // Column 0 and the last column carry data; the middle must stay empty
    // instead of being connected straight through the hole.
    const lines = plotSeries([0, null, 10], { cols: 3, rows: 5 }).text.split("\n");
    const middle = lines.map((l) => l[1]).join("");
    assert.equal(middle.trim(), "", `expected an empty gap column, got ${JSON.stringify(middle)}`);
  });

  it("honours explicit bounds", () => {
    const out = plotSeries([5], { cols: 6, rows: 4, min: 0, max: 100 });
    assert.equal(out.min, 0);
    assert.equal(out.max, 100);
  });

  it("connects steep segments without leaving vertical gaps", () => {
    // Two points at opposite extremes two columns apart: every row between
    // them should be touched, or the trace looks like scattered dots.
    const lines = plotSeries([0, 10], { cols: 2, rows: 6 }).text.split("\n");
    const rowsHit = lines.filter((l) => l.includes(PLOT_DOT)).length;
    assert.equal(rowsHit, 6, "every row between the endpoints should be drawn");
  });

  it("renders an all-null series as blank without throwing", () => {
    const out = plotSeries([null, null], { cols: 5, rows: 3 });
    assert.equal(out.text.replace(/[\n ]/g, ""), "");
  });
});

describe("axisTicks()", () => {
  it("runs from max down to min, matching top-down row order", () => {
    const t = axisTicks(0, 100, 5);
    assert.equal(t[0], 100);
    assert.equal(t[4], 0);
    assert.equal(t.length, 5);
  });

  it("returns just the max for count 1 or 0 instead of dividing by zero", () => {
    // count - 1 is the divisor in the general case; count<=1 has its own
    // explicit branch specifically to dodge that.
    assert.deepEqual(axisTicks(0, 100, 1), [100]);
    assert.deepEqual(axisTicks(0, 100, 0), [100]);
  });
});

describe("renderBarChart()", () => {
  it("renders the requested number of rows", () => {
    assert.equal(renderBarChart([1, 2, 3], { rows: 5 }).split("\n").length, 5);
  });

  it("honours a custom block glyph", () => {
    const lines = renderBarChart([5], { rows: 2, barWidth: 1, block: "▓" }).split("\n");
    assert.ok(
      lines.every((l) => l === "▓"),
      "every filled row should use the custom glyph",
    );
  });

  it("gives the tallest bar full height", () => {
    const lines = renderBarChart([1, 10], { rows: 4, barWidth: 2 }).split("\n");
    assert.ok(lines[0]!.includes("██"), "the max value should reach the top row");
  });

  it("keeps a small non-zero value visible, and draws nothing for zero", () => {
    const lines = renderBarChart([0, 100], { rows: 10, barWidth: 1 }).split("\n");
    const bottom = lines[lines.length - 1]!;
    assert.equal(bottom[0], " ", "zero should render as empty");
    const tiny = renderBarChart([1, 1000], { rows: 10, barWidth: 1 }).split("\n");
    assert.equal(tiny[tiny.length - 1]![0], "█", "a non-zero value must not vanish");
  });
});
