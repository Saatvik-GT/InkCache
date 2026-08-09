import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app, store, metrics } from "../src/network/app.js";

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

  it("treats an empty string value as a hit, not a 404 miss", async () => {
    await request(app).post("/set").send({ key: "a", value: "" }).expect(200);
    const got = await request(app).get("/get/a").expect(200);
    assert.equal(got.body.value, "");
  });

  it("reports ttl:null on /set's own response when ttl is omitted", async () => {
    const res = await request(app).post("/set").send({ key: "a", value: "1" }).expect(200);
    assert.equal(res.body.ttl, null);
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

  it("rejects a ttl so large it would overflow to a never-expiring entry", async () => {
    // ttl: 1e306 is finite on its own, but Date.now() + ttl * 1000 overflows
    // to Infinity -- the entry would never expire, and JSON.stringify(Infinity)
    // serializes as null, making it indistinguishable on the wire from a key
    // that was never given a TTL. Must be rejected outright, not silently
    // accepted with a broken expiry.
    const res = await request(app)
      .post("/set")
      .send({ key: "a", value: "1", ttl: 1e306 })
      .expect(400);
    assert.match(res.body.error, /ttl/);
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

  it("accepts a body comfortably under the 64kb limit", async () => {
    await request(app)
      .post("/set")
      .set("Content-Type", "application/json")
      .send({ key: "big", value: "x".repeat(60_000) })
      .expect(200);
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

  it("returns an empty array (not an error) for /keys on an empty store", async () => {
    const res = await request(app).get("/keys").expect(200);
    assert.deepEqual(res.body.keys, []);
    assert.equal(res.body.count, 0);
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

  it("returns an empty array (not an error) for /keys/stats on an empty store", async () => {
    const res = await request(app).get("/keys/stats").expect(200);
    assert.deepEqual(res.body.keys, []);
    assert.equal(res.body.count, 0);
  });

  it("reports deleted:false for a key that never existed, still 200", async () => {
    const res = await request(app).delete("/delete/never-existed").expect(200);
    assert.equal(res.body.deleted, false);
    assert.equal(res.body.ok, true);
  });

  it("clears the store via /flush", async () => {
    await request(app).post("/set").send({ key: "a", value: "1" }).expect(200);
    await request(app).post("/set").send({ key: "b", value: "2" }).expect(200);
    const res = await request(app).post("/flush").expect(200);
    assert.equal(res.body.dropped, 2);
    await request(app).get("/get/a").expect(404);
    await request(app).get("/get/b").expect(404);
  });

  it("reports dropped:0 flushing an already-empty store, not an error", async () => {
    const res = await request(app).post("/flush").expect(200);
    assert.equal(res.body.dropped, 0);
    assert.equal(res.body.ok, true);
  });

  it("invalidates only keys matching the given prefix", async () => {
    await request(app).post("/set").send({ key: "user:1:profile", value: "a" }).expect(200);
    await request(app).post("/set").send({ key: "user:1:session", value: "b" }).expect(200);
    await request(app).post("/set").send({ key: "user:2:profile", value: "c" }).expect(200);
    const res = await request(app).post("/invalidate").send({ prefix: "user:1:" }).expect(200);
    assert.equal(res.body.dropped, 2);
    assert.equal(res.body.prefix, "user:1:");
    await request(app).get("/get/user:1:profile").expect(404);
    await request(app).get("/get/user:1:session").expect(404);
    await request(app).get("/get/user:2:profile").expect(200);
  });

  it("reports dropped:0 invalidating a prefix that matches nothing, not an error", async () => {
    const res = await request(app).post("/invalidate").send({ prefix: "nope:" }).expect(200);
    assert.equal(res.body.dropped, 0);
    assert.equal(res.body.ok, true);
  });

  it("rejects a non-string prefix", async () => {
    const res = await request(app).post("/invalidate").send({ prefix: 123 }).expect(400);
    assert.match(res.body.error, /prefix/);
  });

  it("rejects a missing prefix", async () => {
    const res = await request(app).post("/invalidate").send({}).expect(400);
    assert.match(res.body.error, /prefix/);
  });

  it("rejects a prefix over the max key length", async () => {
    const res = await request(app)
      .post("/invalidate")
      .send({ prefix: "x".repeat(257) })
      .expect(400);
    assert.match(res.body.error, /256 characters/);
  });

  it("reports the eviction policy and sample size on /metrics", async () => {
    // Asserting against store.evictionPolicy itself would be tautological --
    // it'd pass even if the store's own default were wrong, or /metrics
    // silently reported some other (still string-typed) policy. Assert the
    // concrete defaults instead (no INKCACHE_EVICTION_POLICY/_SAMPLE env
    // vars are set for this test run, so app.ts falls back to these).
    const res = await request(app).get("/metrics").expect(200);
    assert.equal(res.body.evictionPolicy, "access-aware");
    assert.equal(res.body.evictionSampleSize, 5);
  });

  it("reflects real operations in /metrics' own counters, not just /keys/stats'", async () => {
    // The metrics collector is process-lifetime cumulative -- store.clear()
    // in beforeEach resets the store, not these counters -- so this has to
    // assert on the delta this test's own operations cause, not absolute
    // values (which depend on how many prior tests already ran).
    const before = (await request(app).get("/metrics").expect(200)).body;

    await request(app).post("/set").send({ key: "a", value: "1" }).expect(200);
    await request(app).post("/set").send({ key: "b", value: "2" }).expect(200);
    await request(app).get("/get/a").expect(200); // hit
    await request(app).get("/get/nope").expect(404); // miss
    await request(app).delete("/delete/a").expect(200);

    const after = (await request(app).get("/metrics").expect(200)).body;
    assert.equal(after.keys, 1); // only "b" survives the delete
    assert.equal(after.hits - before.hits, 1);
    assert.equal(after.misses - before.misses, 1);
    assert.equal(after.sets - before.sets, 2);
    assert.equal(after.deletes - before.deletes, 1);
  });

  it("reports an empty samples array on /metrics/history before startHistory() runs", async () => {
    // app.ts's own metrics singleton never calls startHistory() itself --
    // only server.ts does, alongside app.listen() -- so under supertest
    // (which never binds a real port) this stays empty unless a test
    // starts it explicitly, like the next test does.
    const res = await request(app).get("/metrics/history").expect(200);
    assert.deepEqual(res.body.samples, []);
  });

  it("reports history samples once startHistory() has ticked", async () => {
    mock.timers.enable({ apis: ["Date", "setInterval"] });
    try {
      metrics.startHistory(1000);
      mock.timers.tick(1000);
      const res = await request(app).get("/metrics/history").expect(200);
      assert.equal(res.body.samples.length, 1);
      assert.equal(typeof res.body.samples[0].at, "number");
      assert.equal(typeof res.body.samples[0].uptimeSec, "number");
    } finally {
      metrics.stopHistory();
      mock.timers.reset();
    }
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

  it("sends the hand-applied security headers on every response", async () => {
    const res = await request(app).get("/health").expect(200);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["x-frame-options"], "DENY");
    assert.equal(res.headers["referrer-policy"], "no-referrer");
  });

  it("does not leak Express's default X-Powered-By header", async () => {
    const res = await request(app).get("/health").expect(200);
    assert.equal(res.headers["x-powered-by"], undefined);
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

  it("answers a CORS preflight OPTIONS request for an allowed origin", async () => {
    const res = await request(app)
      .options("/set")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "POST")
      .expect(204);
    assert.equal(res.headers["access-control-allow-origin"], "http://localhost:5173");
    assert.match(res.headers["access-control-allow-methods"] ?? "", /POST/);
    // cors() answers preflight itself (res.end(), no next()) without ever
    // reaching later middleware -- these three used to silently go missing
    // on exactly this response until the security-headers middleware was
    // moved ahead of cors() in the stack.
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["x-frame-options"], "DENY");
    assert.equal(res.headers["referrer-policy"], "no-referrer");
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
