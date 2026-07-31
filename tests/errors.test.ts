import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeFetchError } from "../src/dashboard/src/lib/errors.js";

describe("describeFetchError()", () => {
  it("reports node-unreachable for a TypeError, fetch's network-failure shape", () => {
    assert.equal(
      describeFetchError(new TypeError("Failed to fetch")),
      "node unreachable — is the cache node running?",
    );
  });

  it("surfaces a real Error's own message", () => {
    assert.equal(describeFetchError(new Error("set failed (500)")), "set failed (500)");
  });

  it("stringifies a non-Error throw instead of crashing", () => {
    assert.equal(describeFetchError("just a string"), "just a string");
    assert.equal(describeFetchError(42), "42");
  });
});
