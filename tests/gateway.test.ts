import { describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app, router } from "../src/network/gateway.js";

/** These exercise gateway.ts's app directly via supertest, without a
    running health checker (setHealthHandle() is never called here) --
    so registration/deregistration falls through to mutating `router`
    directly, the fallback path a gateway process that hasn't started
    health checking yet would use. The real-handle path (a running
    gateway-server.ts process with health checking on) is covered by
    tests/gateway-e2e.test.ts against real spawned processes instead. */
describe("gateway node registration", () => {
  it("registers a new node via POST /cluster/nodes", async () => {
    const res = await request(app)
      .post("/cluster/nodes")
      .send({ url: "http://node-a:8080" })
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.url, "http://node-a:8080");
    assert.ok(router.nodes.includes("http://node-a:8080"));
  });

  it("normalizes a trailing slash on registration", async () => {
    await request(app).post("/cluster/nodes").send({ url: "http://node-b:8080/" }).expect(200);
    assert.ok(router.nodes.includes("http://node-b:8080"));
    assert.ok(!router.nodes.includes("http://node-b:8080/"));
  });

  it("rejects registering the same node twice", async () => {
    await request(app).post("/cluster/nodes").send({ url: "http://node-c:8080" }).expect(200);
    const res = await request(app)
      .post("/cluster/nodes")
      .send({ url: "http://node-c:8080" })
      .expect(409);
    assert.match(res.body.error, /already registered/);
  });

  it("rejects a missing or non-string url", async () => {
    await request(app).post("/cluster/nodes").send({}).expect(400);
    await request(app).post("/cluster/nodes").send({ url: 42 }).expect(400);
    await request(app).post("/cluster/nodes").send({ url: "" }).expect(400);
  });

  it("deregisters a node via DELETE /cluster/nodes", async () => {
    await request(app).post("/cluster/nodes").send({ url: "http://node-d:8080" }).expect(200);
    assert.ok(router.nodes.includes("http://node-d:8080"));
    await request(app).delete("/cluster/nodes").send({ url: "http://node-d:8080" }).expect(200);
    assert.ok(!router.nodes.includes("http://node-d:8080"));
  });

  it("deregistering an unknown node is a no-op, not an error", async () => {
    const res = await request(app)
      .delete("/cluster/nodes")
      .send({ url: "http://never-registered:8080" })
      .expect(200);
    assert.equal(res.body.ok, true);
  });

  it("rejects a missing or non-string url on delete too", async () => {
    await request(app).delete("/cluster/nodes").send({}).expect(400);
  });

  it("GET /cluster/nodes reflects registrations made through POST", async () => {
    await request(app).post("/cluster/nodes").send({ url: "http://node-e:8080" }).expect(200);
    const res = await request(app).get("/cluster/nodes").expect(200);
    const urls = (res.body.nodes as Array<{ url: string }>).map((n) => n.url);
    assert.ok(urls.includes("http://node-e:8080"));
  });
});

describe("gateway-to-gateway sync (POST /cluster/sync)", () => {
  it("merges unknown node URLs from a peer's push into the router", async () => {
    await request(app)
      .post("/cluster/sync")
      .send({ nodes: ["http://from-peer-1:8080", "http://from-peer-2:8080"] })
      .expect(200);
    assert.ok(router.nodes.includes("http://from-peer-1:8080"));
    assert.ok(router.nodes.includes("http://from-peer-2:8080"));
  });

  it("normalizes a trailing slash the same way POST /cluster/nodes does", async () => {
    await request(app)
      .post("/cluster/sync")
      .send({ nodes: ["http://from-peer-3:8080/"] })
      .expect(200);
    assert.ok(router.nodes.includes("http://from-peer-3:8080"));
    assert.ok(!router.nodes.includes("http://from-peer-3:8080/"));
  });

  it("responds with this gateway's own known node list", async () => {
    await request(app)
      .post("/cluster/nodes")
      .send({ url: "http://already-known:8080" })
      .expect(200);
    const res = await request(app).post("/cluster/sync").send({ nodes: [] }).expect(200);
    assert.ok((res.body.nodes as string[]).includes("http://already-known:8080"));
  });

  it("does not error or duplicate on a node this gateway already knows -- unlike POST /cluster/nodes' 409", async () => {
    await request(app).post("/cluster/nodes").send({ url: "http://steady-state:8080" }).expect(200);
    // A second sync push with the same node is normal, repeated gossip
    // traffic, not a conflict -- must stay 200, not 409.
    await request(app)
      .post("/cluster/sync")
      .send({ nodes: ["http://steady-state:8080"] })
      .expect(200);
    assert.equal(router.nodes.filter((u) => u === "http://steady-state:8080").length, 1);
  });

  it("rejects a malformed body", async () => {
    await request(app).post("/cluster/sync").send({}).expect(400);
    await request(app).post("/cluster/sync").send({ nodes: "not-an-array" }).expect(400);
    await request(app)
      .post("/cluster/sync")
      .send({ nodes: [42] })
      .expect(400);
  });

  it("accepts an empty node list without error", async () => {
    await request(app).post("/cluster/sync").send({ nodes: [] }).expect(200);
  });
});
