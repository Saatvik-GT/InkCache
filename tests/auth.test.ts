import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { authHeader, createAuthMiddleware } from "../src/network/auth.js";

function buildApp(apiKey: string | undefined): express.Express {
  const app = express();
  app.use(createAuthMiddleware(apiKey));
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/protected", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("createAuthMiddleware()", () => {
  it("passes every request through when no key is configured", async () => {
    const app = buildApp(undefined);
    await request(app).get("/protected").expect(200);
  });

  it("rejects a request with no key when one is configured", async () => {
    const app = buildApp("secret");
    const res = await request(app).get("/protected").expect(401);
    assert.match(res.body.error, /missing or invalid API key/);
  });

  it("accepts the correct key via X-API-Key", async () => {
    const app = buildApp("secret");
    await request(app).get("/protected").set("X-API-Key", "secret").expect(200);
  });

  it("accepts the correct key via Authorization: Bearer", async () => {
    const app = buildApp("secret");
    await request(app).get("/protected").set("Authorization", "Bearer secret").expect(200);
  });

  it("rejects the wrong key", async () => {
    const app = buildApp("secret");
    await request(app).get("/protected").set("X-API-Key", "wrong").expect(401);
  });

  it("rejects a key of the wrong length, not just the wrong value", async () => {
    const app = buildApp("secret");
    await request(app).get("/protected").set("X-API-Key", "sec").expect(401);
    await request(app).get("/protected").set("X-API-Key", "secretsecret").expect(401);
  });

  it("rejects a non-Bearer Authorization scheme", async () => {
    const app = buildApp("secret");
    await request(app).get("/protected").set("Authorization", "Basic secret").expect(401);
  });

  it("always allows /health, even with the wrong key or no key at all", async () => {
    const app = buildApp("secret");
    await request(app).get("/health").expect(200);
    await request(app).get("/health").set("X-API-Key", "wrong").expect(200);
  });
});

describe("authHeader()", () => {
  it("returns an empty object when no key is set", () => {
    assert.deepEqual(authHeader(undefined), {});
  });

  it("returns an X-API-Key header when a key is set", () => {
    assert.deepEqual(authHeader("secret"), { "x-api-key": "secret" });
  });
});
