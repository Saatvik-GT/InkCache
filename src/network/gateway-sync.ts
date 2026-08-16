/**
 * Gateway-to-gateway node-list gossip (closing "the cluster gateway is
 * a single point of failure" -- the coordination half). Each gateway
 * independently discovers nodes (INKCACHE_CLUSTER_NODES at startup,
 * POST /cluster/nodes at runtime) and independently verifies their
 * health (health-check.ts) -- what was missing was any way for two
 * gateways to converge on the *same* known-node set without every node
 * having to register with every gateway itself.
 *
 * Deliberately not a health-status gossip: this only exchanges *which
 * node URLs exist*, never whether a peer gateway currently thinks one
 * is healthy. Each gateway keeps verifying liveness itself
 * (health-check.ts polls every locally-known node's own /health) --
 * trusting a peer's possibly-stale health opinion instead would let
 * one gateway's slow network path make every gateway wrongly believe
 * a node is down. A newly-learned node is added assumed-healthy (same
 * "trust it enough to have been told about it" reasoning
 * health-check.ts's own addNode() already uses) and verified on this
 * gateway's own next check.
 */

import { authHeader } from "./auth.js";

export interface GatewaySyncHandle {
  stop(): void;
}

async function syncWithPeer(
  peerUrl: string,
  getKnownNodes: () => readonly string[],
  onReceiveNodes: (nodes: readonly string[]) => void,
  apiKey: string | undefined,
  timeoutMs: number,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${peerUrl}/cluster/sync`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader(apiKey) },
      body: JSON.stringify({ nodes: getKnownNodes() }),
      signal: controller.signal,
    });
    if (!res.ok) return;
    const body = (await res.json()) as { nodes?: unknown };
    if (Array.isArray(body.nodes) && body.nodes.every((n) => typeof n === "string")) {
      onReceiveNodes(body.nodes as string[]);
    }
  } catch (err) {
    console.warn(
      `[inkcache-gateway] sync with peer gateway ${peerUrl} failed: ${(err as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Starts periodic gossip with every peer gateway in `peerGatewayUrls`:
 * on each tick, pushes this gateway's own known node list to each peer
 * (`getKnownNodes()`) and merges whatever node list the peer responds
 * with back in (`onReceiveNodes()`) -- a single round trip exchanges
 * knowledge in both directions rather than waiting for the peer's own
 * next tick to push back. One peer being unreachable doesn't affect
 * syncing with the others.
 */
export function startGatewaySync(
  peerGatewayUrls: readonly string[],
  getKnownNodes: () => readonly string[],
  onReceiveNodes: (nodes: readonly string[]) => void,
  intervalMs = 5000,
  apiKey?: string,
  timeoutMs = 1000,
): GatewaySyncHandle {
  async function tick(): Promise<void> {
    await Promise.all(
      peerGatewayUrls.map((peerUrl) =>
        syncWithPeer(peerUrl, getKnownNodes, onReceiveNodes, apiKey, timeoutMs),
      ),
    );
  }

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();

  return { stop: () => clearInterval(timer) };
}
