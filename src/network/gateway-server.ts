/**
 * Process entrypoint for the cluster gateway -- binds gateway.ts's app to
 * a port, starts active health checking against every configured node,
 * and (if peer gateways are configured) starts gossiping known nodes
 * with them. Deliberately as small as server.ts's own entrypoint
 * otherwise: no sweeper, no metrics history, no persistence -- a
 * gateway holds no cache state of its own, so none of that applies here.
 */

import { app, router, CLUSTER_NODES, API_KEY, setHealthHandle } from "./gateway.js";
import { resolveClusterNodes } from "./cluster.js";
import { parsePositiveInt } from "./env.js";
import { startGatewaySync, type GatewaySyncHandle } from "./gateway-sync.js";
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

// Always started, even with zero initial nodes -- POST /cluster/nodes
// (node discovery) needs a live handle to register newly-announced
// nodes against from the moment the gateway is up, not only once
// INKCACHE_CLUSTER_NODES happens to be non-empty.
const healthCheckHandle: HealthCheckHandle = startHealthChecks(
  router,
  CLUSTER_NODES,
  HEALTH_CHECK_INTERVAL_MS,
);
setHealthHandle(healthCheckHandle);

// Opt-in gateway-to-gateway coordination (closing "the cluster gateway
// is a single point of failure" -- see gateway-sync.ts's own header).
// INKCACHE_PEER_GATEWAYS is this gateway's peers, reusing
// resolveClusterNodes()'s comma-separated URL parsing (same shape,
// different env var -- a peer gateway list is exactly a node URL list
// with a different meaning attached). Left unset, no gossip runs at
// all; each gateway then relies purely on nodes registering with it
// directly, same as before this existed.
const PEER_GATEWAYS = resolveClusterNodes(process.env.INKCACHE_PEER_GATEWAYS);
const GATEWAY_SYNC_INTERVAL_MS = parsePositiveInt(
  process.env.INKCACHE_GATEWAY_SYNC_INTERVAL,
  5000,
  "INKCACHE_GATEWAY_SYNC_INTERVAL",
);
let gatewaySyncHandle: GatewaySyncHandle | undefined;
if (PEER_GATEWAYS.length > 0) {
  gatewaySyncHandle = startGatewaySync(
    PEER_GATEWAYS,
    () => healthCheckHandle.status().map((n) => n.url),
    (nodes) => {
      for (const url of nodes) healthCheckHandle.addNode(url);
    },
    GATEWAY_SYNC_INTERVAL_MS,
    API_KEY,
  );
}

const server = app.listen(PORT, () => {
  console.log(
    `[inkcache-gateway] listening on http://localhost:${PORT} (nodes=${CLUSTER_NODES.length}` +
      `${PEER_GATEWAYS.length > 0 ? `, peerGateways=${PEER_GATEWAYS.length}` : ""})`,
  );
  if (CLUSTER_NODES.length === 0) {
    console.warn(
      "[inkcache-gateway] INKCACHE_CLUSTER_NODES is unset -- every request will get a 503 until a node registers itself via POST /cluster/nodes",
    );
  }
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[inkcache-gateway] received ${signal}, shutting down`);
  gatewaySyncHandle?.stop();
  healthCheckHandle.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
