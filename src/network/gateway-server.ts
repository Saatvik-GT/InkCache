/**
 * Process entrypoint for the cluster gateway -- binds gateway.ts's app to
 * a port and starts active health checking against every configured
 * node. Deliberately as small as server.ts's own entrypoint otherwise:
 * no sweeper, no metrics history, no persistence -- a gateway holds no
 * cache state of its own, so none of that applies here.
 */

import { app, router, CLUSTER_NODES, setHealthHandle } from "./gateway.js";
import { parsePositiveInt } from "./env.js";
import { startHealthChecks, type HealthCheckHandle } from "./health-check.js";

const PORT = parsePositiveInt(
  process.env.INKCACHE_GATEWAY_PORT,
  8090,
  "INKCACHE_GATEWAY_PORT",
  65535,
);
const HEALTH_CHECK_INTERVAL_MS = parsePositiveInt(
  process.env.INKCACHE_GATEWAY_HEALTH_INTERVAL,
  2000,
  "INKCACHE_GATEWAY_HEALTH_INTERVAL",
);

let healthCheckHandle: HealthCheckHandle | undefined;
if (CLUSTER_NODES.length > 0) {
  healthCheckHandle = startHealthChecks(router, CLUSTER_NODES, HEALTH_CHECK_INTERVAL_MS);
  setHealthHandle(healthCheckHandle);
}

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
  healthCheckHandle?.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
