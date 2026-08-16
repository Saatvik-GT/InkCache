/**
 * Cluster routing (roadmap Sprint 4, part 2): wires HashRing to real
 * InkCache node URLs, so a gateway process can answer "which node owns
 * this key" without knowing anything about hashing itself.
 *
 * Deliberately split from src/core/hashring.ts: the ring is a pure data
 * structure (string node ids in, string node ids out, no I/O), and this
 * module is the thin layer that turns those ids into real base URLs a
 * gateway can proxy an HTTP request to. Keeping them separate means the
 * ring itself stays unit-testable with zero network involved, matching
 * how replication.ts (network) is split from cache.ts (core) elsewhere
 * in this codebase.
 */

import { HashRing, type HashRingOptions } from "../core/hashring.js";

/** Parses INKCACHE_CLUSTER_NODES: comma-separated node base URLs,
    trimmed, blanks dropped, trailing slashes dropped -- same shape as
    resolveReplicaUrls() in replication.ts, for the same reason. */
export function resolveClusterNodes(envValue: string | undefined): string[] {
  if (!envValue) return [];
  return envValue
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter((s) => s.length > 0);
}

/**
 * A consistent-hashing router over a fixed(-ish) set of InkCache node
 * URLs. Wraps HashRing so callers work in terms of node URLs directly
 * instead of juggling ring node-ids themselves.
 */
export class ClusterRouter {
  private readonly ring: HashRing;

  constructor(nodeUrls: readonly string[] = [], opts: HashRingOptions = {}) {
    this.ring = new HashRing(nodeUrls, opts);
  }

  /** The base URL of the node that owns `key`, or undefined if the
      cluster has no nodes at all. */
  nodeFor(key: string): string | undefined {
    return this.ring.getNode(key);
  }

  addNode(url: string): void {
    this.ring.add(url);
  }

  removeNode(url: string): void {
    this.ring.remove(url);
  }

  get nodes(): string[] {
    return this.ring.nodes;
  }

  get size(): number {
    return this.ring.size;
  }
}
