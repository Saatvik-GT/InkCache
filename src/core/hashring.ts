/**
 * Consistent hashing ring (roadmap Sprint 4): maps a key to one of a set
 * of node identifiers such that adding or removing a node only remaps
 * the keys that land on that node's ring segment, not the whole
 * keyspace -- the property plain `hash(key) % nodeCount` doesn't have
 * (every key remaps the moment nodeCount changes).
 *
 * Deliberately just the ring data structure, with no knowledge of HTTP,
 * InkCache nodes, or health -- src/network/router.ts wires this to real
 * node URLs. Kept in src/core alongside CacheStore/MetricsCollector
 * since, like them, it has zero dependency on the network layer.
 */

import { createHash } from "node:crypto";

export interface HashRingOptions {
  /** How many points each node gets on the ring. More points means
      more even key distribution across nodes (the law-of-large-numbers
      effect of averaging many random segment lengths per node) at the
      cost of a bigger ring to search/rebuild on add/remove. 150 is the
      same default libketama and most consistent-hashing libraries
      converge on. */
  virtualNodes?: number;
}

interface RingPoint {
  hash: number;
  node: string;
}

const DEFAULT_VIRTUAL_NODES = 150;

export class HashRing {
  private ring: RingPoint[] = [];
  private readonly nodeSet = new Set<string>();
  private readonly virtualNodes: number;

  constructor(nodes: readonly string[] = [], opts: HashRingOptions = {}) {
    this.virtualNodes = opts.virtualNodes ?? DEFAULT_VIRTUAL_NODES;
    for (const node of nodes) this.add(node);
  }

  /** Adds a node's virtual points to the ring. A no-op if the node is
      already present -- re-adding an existing node shouldn't duplicate
      its points and skew its share of the keyspace. */
  add(node: string): void {
    if (this.nodeSet.has(node)) return;
    this.nodeSet.add(node);
    for (let i = 0; i < this.virtualNodes; i++) {
      this.ring.push({ hash: hashToUint32(`${node}#${i}`), node });
    }
    this.ring.sort((a, b) => a.hash - b.hash);
  }

  /** Removes a node and every one of its virtual points -- every key
      that was mapped to it lands on the next node clockwise instead.
      Keys mapped to every *other* node are unaffected, which is the
      whole point of consistent hashing over `hash(key) % nodeCount`. */
  remove(node: string): void {
    if (!this.nodeSet.has(node)) return;
    this.nodeSet.delete(node);
    this.ring = this.ring.filter((point) => point.node !== node);
  }

  /** The node that owns `key`: walk clockwise from the key's own hash
      position to the first ring point at or past it, wrapping around to
      the first point on the ring if the key hashes past every point.
      Binary search over the sorted ring -- O(log n) in the number of
      virtual points, not the number of nodes. */
  getNode(key: string): string | undefined {
    if (this.ring.length === 0) return undefined;
    const h = hashToUint32(key);
    let lo = 0;
    let hi = this.ring.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ring[mid]!.hash < h) lo = mid + 1;
      else hi = mid;
    }
    return this.ring[lo === this.ring.length ? 0 : lo]!.node;
  }

  /** Every distinct node currently on the ring, insertion order. */
  get nodes(): string[] {
    return [...this.nodeSet];
  }

  get size(): number {
    return this.nodeSet.size;
  }
}

/** MD5 rather than a hand-rolled hash: this needs to spread keys roughly
    uniformly over a 32-bit space with no obvious clustering, which is
    exactly what a real hash function guarantees and a quick XOR/sum
    roll doesn't. MD5's cryptographic weaknesses are irrelevant here --
    nothing about ring placement is a security boundary, only a
    distribution property. */
function hashToUint32(input: string): number {
  return createHash("md5").update(input).digest().readUInt32BE(0);
}
