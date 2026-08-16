import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Request, Response } from "express";
import request from "supertest";
import { createRateLimiter } from "../src/network/rate-limit.js";

function buildApp(limit: number, windowMs: number, maxTrackedClients?: number): express.Express {
  const app = express();
  app.use(createRateLimiter({ limit, windowMs, maxTrackedClients }));
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/anything", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("createRateLimiter()", () => {
  it("allows requests within the limit", async () => {
    const app = buildApp(3, 10_000);
    await request(app).get("/anything").expect(200);
    await request(app).get("/anything").expect(200);
    await request(app).get("/anything").expect(200);
  });

  it("rejects requests once the limit is exceeded within the window", async () => {
    const app = buildApp(2, 10_000);
    await request(app).get("/anything").expect(200);
    await request(app).get("/anything").expect(200);
    const res = await request(app).get("/anything").expect(429);
    assert.match(res.body.error, /rate limit exceeded/);
  });

  it("sends a Retry-After header on a 429", async () => {
    const app = buildApp(1, 10_000);
    await request(app).get("/anything").expect(200);
    const res = await request(app).get("/anything").expect(429);
    assert.ok(res.headers["retry-after"]);
  });

  it("resets the count once the window elapses", async () => {
    const app = buildApp(1, 100);
    await request(app).get("/anything").expect(200);
    await request(app).get("/anything").expect(429);
    await new Promise((r) => setTimeout(r, 150));
    await request(app).get("/anything").expect(200);
  });

  it("never rate-limits /health, even past the limit", async () => {
    const app = buildApp(1, 10_000);
    await request(app).get("/health").expect(200);
    await request(app).get("/health").expect(200);
    await request(app).get("/health").expect(200);
  });
});

/** supertest's requests all share the same loopback address, so
    per-client tracking has to be exercised by calling the middleware
    directly with fabricated req.ip values instead of going through a
    real Express app + supertest. Only the three things the middleware
    actually touches (req.ip, req.path, and res.status/json/setHeader)
    are faked -- a minimal double, not a full Express mock. */
function call(
  limiter: ReturnType<typeof createRateLimiter>,
  ip: string,
): { statusCode: number; body: unknown; headers: Record<string, string> } {
  const result = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
  };
  const req = { ip, path: "/anything" } as unknown as Request;
  const res = {
    status(code: number) {
      result.statusCode = code;
      return this;
    },
    json(body: unknown) {
      result.body = body;
    },
    setHeader(name: string, value: string) {
      result.headers[name.toLowerCase()] = value;
    },
  } as unknown as Response;
  limiter(req, res, () => {});
  return result;
}

describe("createRateLimiter() per-client tracking (direct middleware calls)", () => {
  it("tracks each client IP independently -- one client's requests don't count against another's", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 10_000 });
    assert.equal(call(limiter, "1.1.1.1").statusCode, 200);
    assert.equal(call(limiter, "2.2.2.2").statusCode, 200); // different client, not throttled by 1.1.1.1's usage
    assert.equal(call(limiter, "1.1.1.1").statusCode, 429); // 1.1.1.1 is now over its own limit
  });

  it("evicts the oldest-tracked client once maxTrackedClients is exceeded", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 10_000, maxTrackedClients: 2 });
    call(limiter, "1.1.1.1"); // tracked: {1.1.1.1}
    call(limiter, "2.2.2.2"); // tracked: {1.1.1.1, 2.2.2.2}
    assert.equal(call(limiter, "1.1.1.1").statusCode, 429); // over its limit of 1

    call(limiter, "3.3.3.3"); // a third client evicts 1.1.1.1, the oldest tracked

    // 1.1.1.1 was evicted, so its count was forgotten -- a fresh
    // request from it succeeds again instead of still being throttled.
    assert.equal(call(limiter, "1.1.1.1").statusCode, 200);
  });
});
