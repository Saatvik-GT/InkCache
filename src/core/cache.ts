/**
 * InkCache core — single-node in-memory key-value store.
 *
 * This is the foundation the distributed layers (replication, consistent
 * hashing, adaptive eviction) will build on. Deliberately dependency-free.
 */

export interface CacheEntry {
  value: string;
  /** Absolute epoch-ms deadline; undefined = never expires. */
  expiresAt?: number;
  /** Reads since this value was set — the frequency signal for eviction. */
  hits: number;
}

export interface SetOptions {
  /** Time-to-live in seconds. Omit for no expiry. */
  ttl?: number;
}

export type EvictionPolicy = "lru" | "access-aware";

export interface CacheStoreOptions {
  /** Max number of entries before eviction kicks in. Default 1000. */
  maxEntries?: number;
  /** Called whenever a key is evicted to make room (not on TTL expiry). */
  onEvict?: (key: string) => void;
  /**
   * "lru" evicts the single least-recently-used key outright. "access-aware"
   * (default) samples the `evictionSampleSize` least-recently-used keys and
   * evicts whichever of *those* has been read the fewest times — a key that
   * gets hit often survives a brief cold spell instead of being evicted the
   * instant something newer edges it out of MRU position. This is a
   * frequency-over-a-recency-window heuristic (in the spirit of window-based
   * LFU admission policies like W-TinyLFU), not a learned/trained model.
   */
  policy?: EvictionPolicy;
  /** Candidate pool size for "access-aware" eviction. Default 5. */
  evictionSampleSize?: number;
}

export class CacheStore {
  private entries = new Map<string, CacheEntry>();
  private sweepTimer?: NodeJS.Timeout;
  private readonly maxEntries: number;
  private readonly onEvict?: (key: string) => void;
  private readonly policy: EvictionPolicy;
  private readonly evictionSampleSize: number;
  private evictionCount = 0;

  constructor(opts: CacheStoreOptions = {}) {
    this.maxEntries = opts.maxEntries ?? 1000;
    this.onEvict = opts.onEvict;
    this.policy = opts.policy ?? "access-aware";
    this.evictionSampleSize = opts.evictionSampleSize ?? 5;
  }

  set(key: string, value: string, opts: SetOptions = {}): void {
    const entry: CacheEntry = { value, hits: 0 };
    if (opts.ttl !== undefined && opts.ttl > 0) {
      entry.expiresAt = Date.now() + opts.ttl * 1000;
    }
    // Delete-then-set so an overwrite also refreshes the key's recency.
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      this.evict();
    }
    this.entries.set(key, entry);
  }

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      // Lazy expiry: a read past the deadline behaves as a miss even if the
      // sweeper hasn't run yet.
      this.entries.delete(key);
      return undefined;
    }
    entry.hits++;
    // Re-insert to move the key to the back of the Map's insertion order,
    // which we use as the recency list (front = least recently used).
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  /** Remaining TTL in seconds, or undefined if the key has no expiry / is gone. */
  ttl(key: string): number | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      // Match get()/has(): a read past the deadline cleans up eagerly.
      this.entries.delete(key);
      return undefined;
    }
    if (entry.expiresAt === undefined) return undefined;
    return Math.max(0, (entry.expiresAt - Date.now()) / 1000);
  }

  /** Reads recorded for a live key since it was last set, or undefined if absent/expired. */
  accessCount(key: string): number | undefined {
    const entry = this.entries.get(key);
    if (!entry || this.isExpired(entry)) return undefined;
    return entry.hits;
  }

  keys(): string[] {
    return [...this.entries.keys()].filter((k) => this.has(k));
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  /** Remove every expired entry; returns how many were dropped. */
  sweep(): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (this.isExpired(entry)) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Periodically purge expired entries so memory is reclaimed without reads. */
  startSweeper(intervalMs = 5000): void {
    this.stopSweeper();
    this.sweepTimer = setInterval(() => this.sweep(), intervalMs);
    // Don't let the sweeper keep the process alive on its own.
    this.sweepTimer.unref?.();
  }

  stopSweeper(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }

  /** Total number of evictions since startup (either policy). */
  get evictions(): number {
    return this.evictionCount;
  }

  /** Active eviction policy, for display/diagnostics. */
  get evictionPolicy(): EvictionPolicy {
    return this.policy;
  }

  /**
   * Free one slot. Prefers reclaiming an expired entry first — evicting a
   * live key to keep a dead one would be wasted capacity — then falls
   * through to the configured policy.
   */
  private evict(): void {
    if (this.sweep() > 0) return;
    if (this.policy === "lru") {
      this.evictOldest();
    } else {
      this.evictLeastAccessed();
    }
  }

  /** Strict LRU: drop the single least-recently-used key. */
  private evictOldest(): void {
    const oldest = this.entries.keys().next();
    if (!oldest.done) this.doEvict(oldest.value);
  }

  /**
   * Scan only the `evictionSampleSize` least-recently-used keys (the front
   * of the Map — see get()/set() for how recency order is maintained) and
   * evict whichever was read the fewest times. Bounded O(sampleSize), not
   * O(n): this never scans the whole store, just the eviction candidates.
   */
  private evictLeastAccessed(): void {
    let worstKey: string | undefined;
    let worstHits = Infinity;
    let seen = 0;
    for (const [key, entry] of this.entries) {
      if (seen >= this.evictionSampleSize) break;
      if (entry.hits < worstHits) {
        worstHits = entry.hits;
        worstKey = key;
      }
      seen++;
    }
    if (worstKey !== undefined) this.doEvict(worstKey);
  }

  private doEvict(key: string): void {
    this.entries.delete(key);
    this.evictionCount++;
    this.onEvict?.(key);
  }

  private isExpired(entry: CacheEntry): boolean {
    return entry.expiresAt !== undefined && Date.now() >= entry.expiresAt;
  }
}
