import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderAsciiText, asciiTextWidth, GLYPH_H } from "../src/dashboard/src/lib/asciiFont.js";

describe("renderAsciiText()", () => {
  it("renders GLYPH_H rows of the width asciiTextWidth() predicts", () => {
    const text = "INKCACHE";
    const lines = renderAsciiText(text).split("\n");
    assert.equal(lines.length, GLYPH_H);
    for (const line of lines) assert.equal(line.length, asciiTextWidth(text));
  });

  it("honours custom on/off glyphs", () => {
    const out = renderAsciiText("I", { on: "@", off: "." });
    assert.ok(out.includes("@"));
    assert.ok(!out.includes(" "));
  });

  it("is case-insensitive", () => {
    assert.equal(renderAsciiText("moon"), renderAsciiText("MOON"));
  });

  it("falls back to blank for an unmapped character instead of throwing", () => {
    const out = renderAsciiText("~");
    assert.equal(out.split("\n").length, GLYPH_H);
    assert.equal(out.replace(/[\n ]/g, ""), "");
  });

  it("tracking widens the gap between letters, not the letters themselves", () => {
    const row = (n: number) => renderAsciiText("II", { on: "#", tracking: n }).split("\n")[1]!;
    const wider = row(2).indexOf("#", row(2).indexOf("#") + 1) - row(2).indexOf("#");
    const narrower = row(0).indexOf("#", row(0).indexOf("#") + 1) - row(0).indexOf("#");
    assert.ok(
      wider > narrower,
      "tracking:2 should space the letters further apart than tracking:0",
    );
  });

  it("returns zero width for empty text", () => {
    assert.equal(asciiTextWidth(""), 0);
  });

  it("pixelWidth widens every pixel and the tracking gap together", () => {
    const text = "AB";
    const lines = renderAsciiText(text, { pixelWidth: 2 }).split("\n");
    // Doubling pixel width must double the whole rendered width, gaps
    // included — widening only the glyphs would drift the letter spacing.
    assert.equal(asciiTextWidth(text, 1, 2), asciiTextWidth(text, 1, 1) * 2);
    for (const line of lines) assert.equal(line.length, asciiTextWidth(text, 1, 2));
  });

  it("pixelWidth 2 emits lit pixels in pairs", () => {
    // A lone vertical stroke at pixelWidth 2 must be two cells wide, not one.
    const row = renderAsciiText("I", { on: "#", pixelWidth: 2 }).split("\n")[1]!;
    assert.ok(row.includes("##"), `expected paired pixels, got ${JSON.stringify(row)}`);
  });

  it("actually differentiates glyphs — O and Q are not the same bitmap", () => {
    assert.notEqual(renderAsciiText("O"), renderAsciiText("Q"));
  });
});
