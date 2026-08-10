/**
 * Optional disk persistence for the cache's contents -- opt-in via
 * INKCACHE_PERSIST_PATH (unset by default, matching the same
 * env-var-driven-feature pattern as everything else in this layer). Lives
 * in src/network, not src/core: core/cache.ts is deliberately dependency-
 * free (see its own header comment), and file I/O is squarely a network/
 * process-lifecycle concern, not core cache logic.
 */
import { readFile, writeFile, rename } from "node:fs/promises";
import type { CacheStore } from "../core/cache.js";

interface PersistedEntry {
  key: string;
  value: string;
  ttl: number | null;
}

/** Atomically write the store's current contents to `path` -- write to a
    sibling temp file first, then rename over the real path, so a process
    killed mid-write never leaves a half-written (corrupt) file behind:
    rename is a single filesystem operation, not a byte-by-byte copy. */
export async function saveSnapshot(store: CacheStore, path: string): Promise<void> {
  const payload = JSON.stringify({ keys: store.exportEntries() });
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, payload, "utf8");
  await rename(tmpPath, path);
}

/** Load a previously-saved snapshot and set every valid entry into `store`.
    Returns how many entries were loaded, or undefined if the file didn't
    exist (the expected case on a first-ever run) or couldn't be read at
    all. Never throws -- a missing or corrupt persistence file shouldn't
    stop the node from starting, just start it empty (with a warning). */
export async function loadSnapshot(store: CacheStore, path: string): Promise<number | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    console.warn(`[inkcache] could not read persistence file ${path}: ${(err as Error).message}`);
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`[inkcache] persistence file ${path} is not valid JSON -- starting empty`);
    return undefined;
  }

  const keys = (parsed as { keys?: unknown }).keys;
  if (!Array.isArray(keys)) {
    console.warn(`[inkcache] persistence file ${path} has no "keys" array -- starting empty`);
    return undefined;
  }

  let loaded = 0;
  for (const entry of keys) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as PersistedEntry).key !== "string" ||
      typeof (entry as PersistedEntry).value !== "string"
    ) {
      // Skip a malformed row rather than aborting the whole load -- one
      // bad line in an otherwise-good file shouldn't cost every other key.
      continue;
    }
    const { key, value, ttl } = entry as PersistedEntry;
    // ttl: null (what saveSnapshot()/exportEntries() write for a no-expiry
    // key) must be treated the same as an omitted ttl -- the exact bug
    // class POST /restore's validateEntry() had to be fixed for.
    store.set(key, value, ttl !== null && ttl !== undefined ? { ttl } : {});
    loaded++;
  }
  return loaded;
}

export interface AutoPersistHandle {
  stop(): void;
}

/** Save a snapshot on a fixed interval. Returns a handle rather than
    managing module-level singleton state, so multiple independent timers
    can exist in tests without interfering with each other. unref()'d,
    same as CacheStore's sweeper and MetricsCollector's history timer --
    a background save shouldn't keep the process alive on its own. */
export function startAutoPersist(
  store: CacheStore,
  path: string,
  intervalMs = 60_000,
): AutoPersistHandle {
  const timer = setInterval(() => {
    saveSnapshot(store, path).catch((err: unknown) => {
      console.warn(`[inkcache] failed to persist snapshot to ${path}: ${(err as Error).message}`);
    });
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
