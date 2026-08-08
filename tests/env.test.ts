import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePositiveInt, resolveEvictionPolicy } from "../src/network/env.js";

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

  it("accepts a value at exactly the optional max, falls back above it", () => {
    assert.equal(parsePositiveInt("65535", 8080, "TEST", 65535), 65535);
    // Regression: INKCACHE_PORT=99999999 used to pass through unvalidated
    // and crash app.listen() with an uncaught RangeError at startup.
    assert.equal(parsePositiveInt("99999999", 8080, "TEST", 65535), 8080);
  });

  it("has no upper bound when max is omitted", () => {
    assert.equal(parsePositiveInt("999999", 512, "TEST"), 999999);
  });
});

describe("resolveEvictionPolicy()", () => {
  it("defaults to access-aware when unset", () => {
    assert.equal(resolveEvictionPolicy(undefined), "access-aware");
  });

  it("accepts all three known policies verbatim", () => {
    assert.equal(resolveEvictionPolicy("lru"), "lru");
    assert.equal(resolveEvictionPolicy("access-aware"), "access-aware");
    assert.equal(resolveEvictionPolicy("lfu"), "lfu");
  });

  it("falls back to access-aware on an unknown value, with a warning", () => {
    assert.equal(resolveEvictionPolicy("lfru"), "access-aware");
    assert.equal(resolveEvictionPolicy(""), "access-aware");
    // Case-sensitive on purpose -- silently accepting "LRU" as "lru" would
    // make the accepted value set fuzzier than the three it actually
    // dispatches on in CacheStore's evict().
    assert.equal(resolveEvictionPolicy("LRU"), "access-aware");
  });
});
