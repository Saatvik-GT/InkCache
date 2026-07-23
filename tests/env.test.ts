import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePositiveInt } from "../src/network/env.js";

describe("parsePositiveInt()", () => {
  it("returns the fallback when unset", () => {
    assert.equal(parsePositiveInt(undefined, 512, "TEST"), 512);
  });

  it("parses a valid positive integer string", () => {
    assert.equal(parsePositiveInt("256", 512, "TEST"), 256);
  });

  it("falls back on a non-numeric string instead of returning NaN", () => {
    assert.equal(parsePositiveInt("abc", 512, "TEST"), 512);
  });

  it("falls back on an empty string", () => {
    assert.equal(parsePositiveInt("", 512, "TEST"), 512);
  });

  it("falls back on zero", () => {
    assert.equal(parsePositiveInt("0", 512, "TEST"), 512);
  });

  it("falls back on a negative number", () => {
    assert.equal(parsePositiveInt("-5", 512, "TEST"), 512);
  });

  it("falls back on a non-integer", () => {
    assert.equal(parsePositiveInt("3.5", 512, "TEST"), 512);
  });
});
