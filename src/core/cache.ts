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
}

export interface SetOptions {
  /** Time-to-live in seconds. Omit for no expiry. */
  ttl?: number;
}

export class CacheStore {
  private entries = new Map<string, CacheEntry>();
  private sweepTimer?: NodeJS.Timeout;

  set(key: string, value: string, opts: SetOptions = {}): void {
    const entry: CacheEntry = { value };
    if (opts.ttl !== undefined && opts.ttl > 0) {
      entry.expiresAt = Date.now() + opts.ttl * 1000;
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
    if (!entry || this.isExpired(entry) || entry.expiresAt === undefined) return undefined;
    return Math.max(0, (entry.expiresAt - Date.now()) / 1000);
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

  private isExpired(entry: CacheEntry): boolean {
    return entry.expiresAt !== undefined && Date.now() >= entry.expiresAt;
  }
}
