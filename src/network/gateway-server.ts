/**
 * Process entrypoint for the cluster gateway -- binds gateway.ts's app to
 * a port. Deliberately as small as server.ts's own entrypoint: no
 * sweeper, no metrics history, no persistence -- a gateway holds no
 * cache state of its own, so none of that applies here.
 */

import { app, CLUSTER_NODES } from "./gateway.js";
import { parsePositiveInt } from "./env.js";

const PORT = parsePositiveInt(
  process.env.INKCACHE_GATEWAY_PORT,
  8090,
  "INKCACHE_GATEWAY_PORT",
  65535,
);

const server = app.listen(PORT, () => {
  console.log(
    `[inkcache-gateway] listening on http://localhost:${PORT} (nodes=${CLUSTER_NODES.length})`,
  );
  if (CLUSTER_NODES.length === 0) {
    console.warn(
      "[inkcache-gateway] INKCACHE_CLUSTER_NODES is unset -- every request will get a 503 until it's configured",
    );
  }
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[inkcache-gateway] received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
