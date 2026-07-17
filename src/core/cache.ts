/**
 * InkCache core — single-node in-memory key-value store.
 *
 * This is the foundation the distributed layers (replication, consistent
 * hashing, adaptive eviction) will build on. Deliberately dependency-free.
 */

export interface CacheEntry {
  value: string;
}

export class CacheStore {
  private entries = new Map<string, CacheEntry>();

  set(key: string, value: string): void {
    this.entries.set(key, { value });
  }

  get(key: string): string | undefined {
    return this.entries.get(key)?.value;
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
