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

  it("returns zero width for empty text", () => {
    assert.equal(asciiTextWidth(""), 0);
  });

  it("actually differentiates glyphs — O and Q are not the same bitmap", () => {
    assert.notEqual(renderAsciiText("O"), renderAsciiText("Q"));
  });
});
