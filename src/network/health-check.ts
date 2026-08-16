/**
 * Active health checking for the cluster gateway (roadmap Sprint 4, part
 * 4: failure handling). The gateway previously built its ClusterRouter
 * once at startup from INKCACHE_CLUSTER_NODES and never revisited it --
 * a node that crashed mid-run stayed in the ring forever, so ~1/n of all
 * keys would route to a dead node until the gateway itself was
 * restarted. This polls every configured node's /health on an interval
 * and pulls a node out of the ring the moment it stops answering,
 * putting it back the moment it answers again.
 *
 * Deliberately simple, not flap-damped: one failed check removes a
 * node, one successful check restores it. A production system would
 * want a failure-count threshold and backoff to avoid a node flapping
 * in and out of the ring on marginal network blips; that's out of
 * scope for a demo gateway checking every couple of seconds, and
 * flap-damping logic with no test load actually exercising it would be
 * exactly the kind of untested complexity CLAUDE.md-adjacent guidance
 * for this project steers away from.
 */

import type { ClusterRouter } from "./cluster.js";

export interface NodeHealth {
  url: string;
  healthy: boolean;
}

export interface HealthCheckHandle {
  stop(): void;
  /** Current known status of every node this checker was configured
      with, healthy or not -- for a /cluster/nodes-style introspection
      endpoint that needs to show *all* configured nodes, not just the
      ones currently in the (healthy-only) router. */
  status(): NodeHealth[];
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
 * Starts polling every node in `allNodes` and keeping `router` in sync:
 * a node that fails its health check is removed from the router (so
 * ClusterRouter.nodeFor() never routes a new request to it), and a node
 * that starts answering again is added back. Every node starts assumed
 * healthy (it was reachable enough to be configured), so the very first
 * request the gateway serves routes normally rather than waiting a full
 * interval for the first check to confirm what's already in the ring.
 */
export function startHealthChecks(
  router: ClusterRouter,
  allNodes: readonly string[],
  intervalMs = 2000,
  timeoutMs = 1000,
): HealthCheckHandle {
  const health = new Map<string, boolean>(allNodes.map((url) => [url, true]));

  async function checkAll(): Promise<void> {
    await Promise.all(
      allNodes.map(async (url) => {
        const healthy = await pingHealthy(url, timeoutMs);
        const wasHealthy = health.get(url) ?? true;
        if (healthy === wasHealthy) return;
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
    status: () => allNodes.map((url) => ({ url, healthy: health.get(url) ?? true })),
  };
}
