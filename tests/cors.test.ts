import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ORIGINS, resolveCorsOrigins } from "../src/network/cors.js";

describe("resolveCorsOrigins()", () => {
  it("returns just the default dev origins when unset", () => {
    assert.deepEqual(resolveCorsOrigins(undefined), DEFAULT_ORIGINS);
  });

  it("returns just the default dev origins for an empty string", () => {
    assert.deepEqual(resolveCorsOrigins(""), DEFAULT_ORIGINS);
  });

  it("appends a single configured origin", () => {
    assert.deepEqual(resolveCorsOrigins("https://dashboard.example.com"), [
      ...DEFAULT_ORIGINS,
      "https://dashboard.example.com",
    ]);
  });

  it("splits multiple comma-separated origins and trims whitespace", () => {
    assert.deepEqual(resolveCorsOrigins(" https://a.example.com , https://b.example.com "), [
      ...DEFAULT_ORIGINS,
      "https://a.example.com",
      "https://b.example.com",
    ]);
  });

  it("drops blank entries from stray/trailing commas", () => {
    assert.deepEqual(resolveCorsOrigins("https://a.example.com,,"), [
      ...DEFAULT_ORIGINS,
      "https://a.example.com",
    ]);
  });
});
