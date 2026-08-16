/**
 * Active health checking for the cluster gateway (roadmap Sprint 4, part
 * 4: failure handling). The gateway previously built its ClusterRouter
 * once at startup from INKCACHE_CLUSTER_NODES and never revisited it --
 * a node that crashed mid-run stayed in the ring forever, so ~1/n of all
 * keys would route to a dead node until the gateway itself was
 * restarted. This polls every known node's /health on an interval and
 * pulls a node out of the ring the moment it stops answering, putting
 * it back the moment it answers again.
 *
 * The known node set is mutable (addNode()/removeNode() on the returned
 * handle), not fixed at construction -- that's what lets Sprint 4's
 * other missing piece, node discovery, work: a node can be registered
 * at runtime (see gateway.ts's POST /cluster/nodes) and this checker
 * picks it up on its very next tick, same as any node given at startup.
 *
 * Deliberately simple, not flap-damped: one failed check removes a
 * node, one successful check restores it. A production system would
 * want a failure-count threshold and backoff to avoid a node flapping
 * in and out of the ring on marginal network blips; that's out of
 * scope for a demo gateway checking every couple of seconds, and
 * flap-damping logic with no test load actually exercising it would be
 * exactly the kind of untested complexity this project steers away from.
 */

import type { ClusterRouter } from "./cluster.js";

export interface NodeHealth {
  url: string;
  healthy: boolean;
}

export interface HealthCheckHandle {
  stop(): void;
  /** Current known status of every node this checker knows about,
      healthy or not -- for a /cluster/nodes-style introspection
      endpoint that needs to show *all* known nodes, not just the ones
      currently in the (healthy-only) router. */
  status(): NodeHealth[];
  /** Registers a new node to monitor, assumed healthy until its first
      check says otherwise (same "trust it enough to have been
      registered" reasoning as the initial node set). Also adds it to
      the router immediately, same as a node recovering from a failed
      check would be. A no-op if the node is already known. */
  addNode(url: string): void;
  /** Stops monitoring a node and removes it from the router. A no-op if
      the node isn't known. */
  removeNode(url: string): void;
}

async function pingHealthy(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Starts polling every node in `initialNodes` (may be empty -- nodes can
 * be added later via the handle) and keeping `router` in sync. Every
 * node starts assumed healthy, so the very first request the gateway
 * serves after a node is known routes normally rather than waiting a
 * full interval for the first check to confirm what's already in the
 * ring.
 */
export function startHealthChecks(
  router: ClusterRouter,
  initialNodes: readonly string[] = [],
  intervalMs = 2000,
  timeoutMs = 1000,
): HealthCheckHandle {
  const health = new Map<string, boolean>(initialNodes.map((url) => [url, true]));

  async function checkAll(): Promise<void> {
    await Promise.all(
      [...health.keys()].map(async (url) => {
        const healthy = await pingHealthy(url, timeoutMs);
        const wasHealthy = health.get(url);
        // The node may have been removeNode()'d while this check was
        // in flight -- don't resurrect it into the map or the router.
        if (wasHealthy === undefined || healthy === wasHealthy) return;
        health.set(url, healthy);
        if (healthy) {
          console.log(`[inkcache-gateway] node ${url} is back -- adding to the ring`);
          router.addNode(url);
        } else {
          console.warn(
            `[inkcache-gateway] node ${url} failed its health check -- removing from the ring`,
          );
          router.removeNode(url);
        }
      }),
    );
  }

  const timer = setInterval(() => void checkAll(), intervalMs);
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
    status: () => [...health.entries()].map(([url, healthy]) => ({ url, healthy })),
    addNode: (url) => {
      if (health.has(url)) return;
      health.set(url, true);
      router.addNode(url);
    },
    removeNode: (url) => {
      if (!health.has(url)) return;
      health.delete(url);
      router.removeNode(url);
    },
  };
}
