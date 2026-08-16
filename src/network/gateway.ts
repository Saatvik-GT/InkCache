/**
 * Cluster gateway (roadmap Sprint 4, part 3): a thin Express app that
 * proxies /set, /get/:key, /delete/:key to whichever InkCache node
 * ClusterRouter says owns the key, over real HTTP. A client that talks
 * to the gateway doesn't need to know the cluster's node list or
 * hashing at all -- same shape as a real routing tier in front of a
 * sharded store.
 *
 * Deliberately a separate small app/entrypoint from src/network/app.ts,
 * not a mode of it: a gateway process holds no cache state of its own
 * (it's pure routing), so folding it into the same file would mean every
 * cache-node route also had to account for "what if this process is
 * actually a gateway" -- more branching for no benefit, since nothing
 * about MetricsCollector/CacheStore/persistence/replication applies to
 * a gateway.
 */

import express from "express";
import cors from "cors";
import { authHeader, createAuthMiddleware } from "./auth.js";
import { ClusterRouter, resolveClusterNodes } from "./cluster.js";
import { resolveCorsOrigins } from "./cors.js";
import { parsePositiveInt } from "./env.js";
import type { HealthCheckHandle } from "./health-check.js";
import { createRateLimiter } from "./rate-limit.js";

export const CLUSTER_NODES = resolveClusterNodes(process.env.INKCACHE_CLUSTER_NODES);
export const router = new ClusterRouter(CLUSTER_NODES);

// Same shared-secret model as a cache node's own INKCACHE_API_KEY (see
// auth.ts) -- a gateway forwards this exact key when it proxies to a
// node, so the whole cluster (nodes, replicas, gateway) shares one
// secret rather than needing a distinct key per hop.
export const API_KEY = process.env.INKCACHE_API_KEY;
const RATE_LIMIT_ENV = process.env.INKCACHE_RATE_LIMIT;
const RATE_LIMIT =
  RATE_LIMIT_ENV !== undefined
    ? parsePositiveInt(RATE_LIMIT_ENV, 100, "INKCACHE_RATE_LIMIT")
    : undefined;
const RATE_LIMIT_WINDOW_MS =
  parsePositiveInt(process.env.INKCACHE_RATE_LIMIT_WINDOW, 10, "INKCACHE_RATE_LIMIT_WINDOW") * 1000;

// Set by gateway-server.ts once health checking starts -- kept as an
// external hook rather than started here so this module stays free of
// background timers on import, same as app.ts leaving CacheStore's
// sweeper for server.ts's start() to kick off rather than starting it
// as a module-level side effect.
let healthHandle: HealthCheckHandle | undefined;
export function setHealthHandle(handle: HealthCheckHandle): void {
  healthHandle = handle;
}

const CORS_ORIGINS = resolveCorsOrigins(process.env.INKCACHE_CORS_ORIGIN);

export const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: CORS_ORIGINS }));
if (RATE_LIMIT !== undefined) {
  app.use(createRateLimiter({ limit: RATE_LIMIT, windowMs: RATE_LIMIT_WINDOW_MS }));
}
app.use(createAuthMiddleware(API_KEY));
app.use(express.json({ limit: "64kb" }));
app.use(
  (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && "body" in err) {
      return res.status(400).json({ error: "malformed JSON body" });
    }
    next(err);
  },
);

/** Forwards a request to `nodeUrl`, relaying its status and JSON body
    back verbatim -- the gateway doesn't reinterpret a node's response,
    just routes to it. A node that's down or unreachable becomes a 502
    from the gateway rather than the raw fetch error leaking through. */
async function proxy(
  res: express.Response,
  nodeUrl: string,
  path: string,
  init?: RequestInit,
): Promise<void> {
  try {
    const upstream = await fetch(`${nodeUrl}${path}`, {
      ...init,
      headers: { ...init?.headers, ...authHeader(API_KEY) },
    });
    const body: unknown = await upstream.json().catch(() => ({}));
    res.status(upstream.status).json(body);
  } catch (err) {
    res.status(502).json({
      error: `node ${nodeUrl} unreachable: ${(err as Error).message}`,
    });
  }
}

function requireNode(res: express.Response, key: string): string | undefined {
  if (router.size === 0) {
    res.status(503).json({ error: "no cluster nodes configured" });
    return undefined;
  }
  return router.nodeFor(key);
}

app.post("/set", async (req, res) => {
  const { key } = (req.body ?? {}) as { key?: unknown };
  if (typeof key !== "string" || key.length === 0) {
    return res.status(400).json({ error: "key must be a non-empty string" });
  }
  const nodeUrl = requireNode(res, key);
  if (!nodeUrl) return;
  await proxy(res, nodeUrl, "/set", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req.body ?? {}),
  });
});

app.get("/get/:key", async (req, res) => {
  const nodeUrl = requireNode(res, req.params.key);
  if (!nodeUrl) return;
  await proxy(res, nodeUrl, `/get/${encodeURIComponent(req.params.key)}`);
});

app.delete("/delete/:key", async (req, res) => {
  const nodeUrl = requireNode(res, req.params.key);
  if (!nodeUrl) return;
  await proxy(res, nodeUrl, `/delete/${encodeURIComponent(req.params.key)}`, {
    method: "DELETE",
  });
});

/** Which node currently owns a key, without performing the read/write --
    lets a client (or the dashboard) show routing without side effects. */
app.get("/cluster/route/:key", (req, res) => {
  const nodeUrl = requireNode(res, req.params.key);
  if (!nodeUrl) return;
  res.json({ key: req.params.key, node: nodeUrl });
});

/** Every currently-*known* node -- which starts as INKCACHE_CLUSTER_NODES
    but grows/shrinks at runtime via POST/DELETE below -- each with its
    current health. Without a running health checker (setHealthHandle()
    never called), falls back to the router's own live node list (not
    the static INKCACHE_CLUSTER_NODES constant, which only ever reflects
    startup and would silently hide anything registered afterward);
    every node in that fallback is reported healthy, since nothing has
    ever marked one otherwise. */
app.get("/cluster/nodes", (_req, res) => {
  const status = healthHandle?.status() ?? router.nodes.map((url) => ({ url, healthy: true }));
  res.json({ nodes: status, healthyCount: router.size, count: status.length });
});

/** Registers a new node with the cluster at runtime (roadmap Sprint 4's
    remaining piece: node discovery) -- INKCACHE_CLUSTER_NODES is only
    the *initial* set a gateway starts with, not a hard ceiling. A node
    can announce itself here directly (curl/an operator) or via
    server.ts's own INKCACHE_GATEWAY_URL self-registration on startup.
    The node is added to both the router and the health checker (if
    running) immediately, so it starts receiving traffic and being
    monitored right away rather than waiting for the next full restart. */
app.post("/cluster/nodes", (req, res) => {
  const { url } = (req.body ?? {}) as { url?: unknown };
  if (typeof url !== "string" || url.length === 0) {
    return res.status(400).json({ error: "url must be a non-empty string" });
  }
  const normalized = url.trim().replace(/\/$/, "");
  const alreadyKnown = (healthHandle?.status().map((n) => n.url) ?? router.nodes).includes(
    normalized,
  );
  if (alreadyKnown) {
    return res.status(409).json({ error: `node ${normalized} is already registered` });
  }
  if (healthHandle) {
    healthHandle.addNode(normalized);
  } else {
    router.addNode(normalized);
  }
  return res.json({ ok: true, url: normalized, count: router.size });
});

/** Deregisters a node -- e.g. a node announcing its own graceful
    shutdown (see server.ts), or an operator manually decommissioning
    one. Removing a node that isn't known is a no-op, not an error, same
    tolerance /delete/:key already has for a key that never existed. */
app.delete("/cluster/nodes", (req, res) => {
  const { url } = (req.body ?? {}) as { url?: unknown };
  if (typeof url !== "string" || url.length === 0) {
    return res.status(400).json({ error: "url must be a non-empty string" });
  }
  const normalized = url.trim().replace(/\/$/, "");
  if (healthHandle) {
    healthHandle.removeNode(normalized);
  } else {
    router.removeNode(normalized);
  }
  return res.json({ ok: true, url: normalized, count: router.size });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    role: "gateway",
    nodes: router.size,
    timestamp: new Date().toISOString(),
  });
});

app.use((req, res) => {
  res.status(404).json({ error: "not found", path: req.path });
});

app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[inkcache-gateway] unhandled error:", err);
    res.status(500).json({ error: "internal server error" });
  },
);
