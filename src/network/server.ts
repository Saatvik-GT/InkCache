/**
 * Process entrypoint: binds the Express app from app.ts to a port and wires
 * up the TTL sweeper, metrics history, optional disk persistence, and
 * graceful shutdown.
 */

import {
  app,
  store,
  metrics,
  MAX_ENTRIES,
  NODE_ID,
  ROLE,
  PRIMARY_URL,
  REPLICA_URLS,
  API_KEY,
  setPrimaryMonitorHandle,
} from "./app.js";
import { authHeader } from "./auth.js";
import { parsePositiveInt } from "./env.js";
import {
  loadSnapshot,
  saveSnapshot,
  startAutoPersist,
  type AutoPersistHandle,
} from "./persistence.js";
import { startPrimaryMonitor, type PrimaryMonitorHandle } from "./primary-monitor.js";
// resolveReplicaUrls does exactly the URL-list parsing this file also
// needs for INKCACHE_GATEWAY_URL (comma-separated, trimmed, trailing
// slash stripped, blanks dropped) -- reused under a clearer local name
// rather than duplicating the same five lines a third time in this
// codebase (cors.ts and cluster.ts each already have their own near-
// identical version for their own env var).
import { resolveReplicaUrls as resolveUrlList, syncFromPrimary } from "./replication.js";

// PORT only matters here (app.ts never binds a port), but MAX_ENTRIES and
// NODE_ID are imported rather than recomputed — a second, independently
// -defaulted copy of the same env var is exactly how this file's startup
// log line ended up printing "maxEntries=NaN" while the store itself
// correctly fell back, and how a NODE_ID default change in app.ts could
// silently stop matching what this file logs.
// max 65535: app.listen() throws a synchronous, uncaught RangeError for
// anything past the valid TCP port range -- an unvalidated upper bound
// meant e.g. INKCACHE_PORT=99999999 crashed the process at startup
// instead of falling back with a warning like every other garbage value.
const PORT = parsePositiveInt(process.env.INKCACHE_PORT, 8080, "INKCACHE_PORT", 65535);

// Opt-in disk persistence: unset by default, matching every other env-var
// -gated feature in this layer. When set, the cache's contents are loaded
// back on startup and saved periodically, instead of always starting
// empty and losing everything on restart.
const PERSIST_PATH = process.env.INKCACHE_PERSIST_PATH;
const PERSIST_INTERVAL_MS =
  parsePositiveInt(process.env.INKCACHE_PERSIST_INTERVAL, 60, "INKCACHE_PERSIST_INTERVAL") * 1000;

// Opt-in node discovery (roadmap Sprint 4's last piece): if both are
// set, this node announces itself to one or more cluster gateways
// (comma-separated) on startup and deregisters from each on a graceful
// shutdown, instead of an operator having to curl POST /cluster/nodes
// by hand every time a node joins. Requires an explicit externally-
// reachable INKCACHE_SELF_URL rather than guessing one from
// INKCACHE_PORT -- "localhost:PORT" would be wrong the moment this node
// and a gateway aren't on the same host (Docker, a real multi-machine
// cluster), and guessing wrong silently registers a URL nothing can
// actually reach.
//
// Registering with *multiple* gateways (rather than one) is what
// actually closes the "the cluster gateway is a single point of
// failure" limitation docs/architecture.md documents: each gateway is
// already independently stateless (it derives its whole view of the
// cluster from health checks + registrations, nothing shared between
// gateway processes), so running two behind a client-side failover or
// a plain TCP load balancer only needed every node to tell *both* about
// itself -- which is exactly what this does. Nothing here makes the
// gateways aware of each other; there's still no gateway-to-gateway
// coordination, just every node independently fanning out to all of
// them.
const GATEWAY_URLS = resolveUrlList(process.env.INKCACHE_GATEWAY_URL);
const SELF_URL = process.env.INKCACHE_SELF_URL;

// Primary liveness monitoring (automatic primary promotion, part 2 of
// N): a replica polls its own primary's /health on this interval so it
// has a live, continuously-updated view of whether its primary is
// still reachable, surfaced via GET /health's primaryHealthy /
// primaryConsecutiveFailures fields. This module only observes for
// now -- nothing here promotes anything yet.
const PRIMARY_MONITOR_INTERVAL_MS = parsePositiveInt(
  process.env.INKCACHE_PRIMARY_MONITOR_INTERVAL,
  2000,
  "INKCACHE_PRIMARY_MONITOR_INTERVAL",
);

let server: ReturnType<typeof app.listen> | undefined;
let persistHandle: AutoPersistHandle | undefined;
let primaryMonitorHandle: PrimaryMonitorHandle | undefined;

/** Best-effort registration/deregistration with every configured
    gateway, independently -- one gateway being unreachable must not
    stop this node from registering with the others. Never throws: a
    node that can't reach any gateway should still come up and serve
    direct traffic, not refuse to start over a discovery announcement
    failing. */
async function announceToGateway(op: "register" | "deregister"): Promise<void> {
  if (GATEWAY_URLS.length === 0 || !SELF_URL) return;
  await Promise.all(
    GATEWAY_URLS.map(async (gatewayUrl) => {
      try {
        // authHeader(API_KEY): this node's own INKCACHE_API_KEY, on the
        // assumption every process in a cluster that has auth enabled
        // shares the same one secret (see auth.ts's header comment) --
        // there's no separate "gateway key" to configure.
        const res = await fetch(`${gatewayUrl}/cluster/nodes`, {
          method: op === "register" ? "POST" : "DELETE",
          headers: { "content-type": "application/json", ...authHeader(API_KEY) },
          body: JSON.stringify({ url: SELF_URL }),
        });
        // 409 (already registered) on a register call is expected on a
        // restart racing the gateway's own stale-entry cleanup -- not
        // worth warning about the way a genuine failure is.
        if (!res.ok && !(op === "register" && res.status === 409)) {
          console.warn(`[inkcache] ${op} with gateway ${gatewayUrl} returned HTTP ${res.status}`);
        } else {
          console.log(`[inkcache] ${op}ed with gateway ${gatewayUrl} as ${SELF_URL}`);
        }
      } catch (err) {
        console.warn(
          `[inkcache] failed to ${op} with gateway ${gatewayUrl}: ${(err as Error).message}`,
        );
      }
    }),
  );
}

async function start(): Promise<void> {
  if (PERSIST_PATH) {
    const loaded = await loadSnapshot(store, PERSIST_PATH);
    if (loaded !== undefined) {
      console.log(`[inkcache] restored ${loaded} key(s) from ${PERSIST_PATH}`);
    }
    persistHandle = startAutoPersist(store, PERSIST_PATH, PERSIST_INTERVAL_MS);
  }

  // A replica pulls its primary's full snapshot once at startup so it
  // isn't serving empty/stale data before the first replicated write
  // arrives. Runs before listen() so nothing is exposed mid-sync. Bounded
  // retries inside syncFromPrimary() -- see its own comment for why.
  if (ROLE === "replica" && PRIMARY_URL) {
    const loaded = await syncFromPrimary(store, PRIMARY_URL, undefined, undefined, API_KEY);
    console.log(`[inkcache] synced ${loaded} key(s) from primary ${PRIMARY_URL}`);

    primaryMonitorHandle = startPrimaryMonitor(PRIMARY_URL, PRIMARY_MONITOR_INTERVAL_MS);
    setPrimaryMonitorHandle(primaryMonitorHandle);
  }

  store.startSweeper();
  metrics.startHistory();

  server = app.listen(PORT, () => {
    console.log(
      `[inkcache] ${NODE_ID} listening on http://localhost:${PORT} ` +
        `(maxEntries=${MAX_ENTRIES}, evictionPolicy=${store.evictionPolicy}, role=${ROLE}` +
        `${ROLE === "primary" && REPLICA_URLS.length > 0 ? `, replicas=${REPLICA_URLS.length}` : ""})`,
    );
  });

  await announceToGateway("register");
}

void start();

async function shutdown(signal: string): Promise<void> {
  console.log(`[inkcache] received ${signal}, shutting down`);
  await announceToGateway("deregister");
  store.stopSweeper();
  metrics.stopHistory();
  primaryMonitorHandle?.stop();
  persistHandle?.stop();
  if (PERSIST_PATH) {
    // Best-effort final save so whatever changed since the last periodic
    // tick isn't silently lost on an otherwise-clean shutdown.
    await saveSnapshot(store, PERSIST_PATH).catch((err: unknown) => {
      console.warn(`[inkcache] final persist on shutdown failed: ${(err as Error).message}`);
    });
  }
  if (server) {
    server.close(() => process.exit(0));
  } else {
    // Signal arrived before start() finished listening -- nothing to close.
    process.exit(0);
  }
  // server.close() waits for in-flight connections to end on their own,
  // which can hang indefinitely on a lingering keep-alive socket. Force
  // the exit rather than risk out-waiting a host's shutdown grace period
  // (e.g. Docker's default 10s before SIGKILL) and getting killed mid-write.
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
