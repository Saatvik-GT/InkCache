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
import { ClusterRouter, resolveClusterNodes } from "./cluster.js";
import { resolveCorsOrigins } from "./cors.js";

export const CLUSTER_NODES = resolveClusterNodes(process.env.INKCACHE_CLUSTER_NODES);
export const router = new ClusterRouter(CLUSTER_NODES);

const CORS_ORIGINS = resolveCorsOrigins(process.env.INKCACHE_CORS_ORIGIN);

export const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: CORS_ORIGINS }));
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
    const upstream = await fetch(`${nodeUrl}${path}`, init);
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

app.get("/cluster/nodes", (_req, res) => {
  res.json({ nodes: router.nodes, count: router.size });
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
