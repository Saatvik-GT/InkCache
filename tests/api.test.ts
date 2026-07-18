import { describe, it, beforeEach } from "node:test";
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

  it("rejects a set with a missing key", async () => {
    const res = await request(app).post("/set").send({ value: "1" }).expect(400);
    assert.match(res.body.error, /key/);
  });

  it("returns malformed-JSON as a 400 with a JSON body", async () => {
    const res = await request(app)
      .post("/set")
      .set("Content-Type", "application/json")
      .send("{not json")
      .expect(400);
    assert.equal(res.body.error, "malformed JSON body");
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
});
