import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app, store } from "../src/network/app.js";

describe("REST API", () => {
  beforeEach(() => {
    store.clear();
  });

  it("round-trips a value through set/get/delete", async () => {
    await request(app).post("/set").send({ key: "a", value: "1" }).expect(200);
    const got = await request(app).get("/get/a").expect(200);
    assert.equal(got.body.value, "1");
    await request(app).delete("/delete/a").expect(200);
    await request(app).get("/get/a").expect(404);
  });

  it("round-trips a key containing a slash, URL-encoded in the path", async () => {
    await request(app).post("/set").send({ key: "a/b", value: "slash-key" }).expect(200);
    const got = await request(app).get("/get/a%2Fb").expect(200);
    assert.equal(got.body.key, "a/b");
    assert.equal(got.body.value, "slash-key");
  });

  it("rejects a set with a missing key", async () => {
    const res = await request(app).post("/set").send({ value: "1" }).expect(400);
    assert.match(res.body.error, /key/);
  });

  it("accepts a key at exactly the 256-char limit, rejects one over it", async () => {
    await request(app)
      .post("/set")
      .send({ key: "x".repeat(256), value: "1" })
      .expect(200);
    const res = await request(app)
      .post("/set")
      .send({ key: "x".repeat(257), value: "1" })
      .expect(400);
    assert.match(res.body.error, /256 characters/);
  });

  it("rejects a zero or negative ttl at the API layer, not just the core", async () => {
    const zero = await request(app).post("/set").send({ key: "a", value: "1", ttl: 0 }).expect(400);
    assert.match(zero.body.error, /ttl/);
    const negative = await request(app)
      .post("/set")
      .send({ key: "a", value: "1", ttl: -5 })
      .expect(400);
    assert.match(negative.body.error, /ttl/);
  });

  it("rejects a non-string value", async () => {
    const res = await request(app).post("/set").send({ key: "a", value: 42 }).expect(400);
    assert.match(res.body.error, /value must be a string/);
  });

  it("rejects a non-string key", async () => {
    const res = await request(app).post("/set").send({ key: 123, value: "1" }).expect(400);
    assert.match(res.body.error, /non-empty string/);
  });

  it("rejects a whitespace-only key", async () => {
    const res = await request(app).post("/set").send({ key: "   ", value: "1" }).expect(400);
    assert.match(res.body.error, /non-empty string/);
  });

  it("returns malformed-JSON as a 400 with a JSON body", async () => {
    const res = await request(app)
      .post("/set")
      .set("Content-Type", "application/json")
      .send("{not json")
      .expect(400);
    assert.equal(res.body.error, "malformed JSON body");
  });

  it("returns an oversized body as a JSON 413, not Express's default HTML error page", async () => {
    const res = await request(app)
      .post("/set")
      .set("Content-Type", "application/json")
      .send({ key: "big", value: "x".repeat(70_000) })
      .expect(413);
    assert.equal(res.body.error, "request body too large (max 64kb)");
  });

  it("lists active keys via /keys", async () => {
    await request(app).post("/set").send({ key: "a", value: "1" }).expect(200);
    await request(app).post("/set").send({ key: "b", value: "2" }).expect(200);
    const res = await request(app).get("/keys").expect(200);
    assert.deepEqual(res.body.keys.sort(), ["a", "b"]);
    assert.equal(res.body.count, 2);
  });

  it("reports per-key hit counts and ttl via /keys/stats", async () => {
    await request(app).post("/set").send({ key: "a", value: "1" }).expect(200);
    await request(app).get("/get/a").expect(200);
    await request(app).get("/get/a").expect(200);
    const res = await request(app).get("/keys/stats").expect(200);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.keys[0].key, "a");
    assert.equal(res.body.keys[0].hits, 2);
    assert.equal(res.body.keys[0].ttl, null);
  });

  it("clears the store via /flush", async () => {
    await request(app).post("/set").send({ key: "a", value: "1" }).expect(200);
    const res = await request(app).post("/flush").expect(200);
    assert.equal(res.body.dropped, 1);
    await request(app).get("/get/a").expect(404);
  });

  it("reports the eviction policy and sample size on /metrics", async () => {
    const res = await request(app).get("/metrics").expect(200);
    assert.equal(res.body.evictionPolicy, store.evictionPolicy);
    assert.equal(typeof res.body.evictionSampleSize, "number");
  });

  it("reports health and version", async () => {
    const health = await request(app).get("/health").expect(200);
    assert.equal(health.body.status, "ok");
    const version = await request(app).get("/version").expect(200);
    assert.equal(version.body.name, "inkcache");
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const res = await request(app).get("/nope").expect(404);
    assert.equal(res.body.error, "not found");
  });

  it("sends the CORS header for the allowed dev origin, not for a random one", async () => {
    const allowed = await request(app)
      .get("/health")
      .set("Origin", "http://localhost:5173")
      .expect(200);
    assert.equal(allowed.headers["access-control-allow-origin"], "http://localhost:5173");

    const disallowed = await request(app)
      .get("/health")
      .set("Origin", "https://not-allowed.example.com")
      .expect(200); // cors() doesn't block the response, just omits the header —
    // the browser is what actually enforces same-origin policy client-side.
    assert.equal(disallowed.headers["access-control-allow-origin"], undefined);
  });

  it("returns a JSON 500 for a genuinely unexpected error, not Express's default HTML page", async () => {
    const getMock = mock.method(store, "get", () => {
      throw new Error("simulated unexpected failure");
    });
    try {
      const res = await request(app).get("/get/anything").expect(500);
      assert.equal(res.body.error, "internal server error");
      assert.equal(res.type, "application/json");
    } finally {
      getMock.mock.restore();
    }
  });
});
