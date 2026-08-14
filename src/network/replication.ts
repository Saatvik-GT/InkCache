/**
 * Primary-replica replication (roadmap Sprint 3): a primary node forwards
 * every write to a set of replica nodes over plain HTTP, and a replica
 * pulls a full snapshot from its primary once at startup to catch up
 * before serving. Deliberately not consensus-based or strongly consistent
 * -- this is best-effort, asynchronous, single-primary replication, the
 * same trade-off Redis's own default replication makes.
 */

import type { CacheStore } from "../core/cache.js";

export type ReplicationOp =
  | { op: "set"; key: string; value: string; ttl?: number }
  | { op: "delete"; key: string }
  | { op: "invalidate"; prefix: string }
  | { op: "flush" };

/** Parses INKCACHE_REPLICA_URLS: comma-separated, trimmed, blanks dropped --
    same shape as resolveCorsOrigins() in cors.ts, for the same reason (a
    stray trailing comma or extra space in an env var shouldn't produce a
    silently-broken empty-string target). */
export function resolveReplicaUrls(envValue: string | undefined): string[] {
  if (!envValue) return [];
  return envValue
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter((s) => s.length > 0);
}

/**
 * Push one op to every configured replica, fire-and-forget. Never throws
 * and never blocks the caller past the fetch call itself -- a primary's
 * write latency must not depend on how many replicas it has or whether
 * one of them is currently down. Failures are logged, not retried: a
 * replica that missed an op will still catch up on its next full
 * snapshot pull (a restart), which is an acceptable staleness window for
 * best-effort replication, not a strongly-consistent log.
 */
export function forwardToReplicas(replicaUrls: readonly string[], op: ReplicationOp): void {
  for (const url of replicaUrls) {
    fetch(`${url}/internal/replicate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(op),
    }).catch((err: unknown) => {
      console.warn(`[inkcache] failed to replicate ${op.op} to ${url}: ${(err as Error).message}`);
    });
  }
}

/** Apply a replicated op directly to the local store, bypassing the
    normal /set /delete /invalidate /flush HTTP validation -- the primary
    already validated it once, and re-validating here would just be
    duplicate work on every single replicated write. */
export function applyReplicationOp(store: CacheStore, op: ReplicationOp): void {
  switch (op.op) {
    case "set":
      store.set(op.key, op.value, { ttl: op.ttl });
      break;
    case "delete":
      store.delete(op.key);
      break;
    case "invalidate":
      store.deleteByPrefix(op.prefix);
      break;
    case "flush":
      store.clear();
      break;
  }
}

/**
 * One-time startup sync for a replica: pull the primary's full snapshot
 * and load it into the local store. Retries with a short fixed backoff --
 * the replica and primary are typically started close together (e.g. by
 * docker-compose), so the primary may not be answering yet on the
 * replica's very first attempt. Gives up after maxAttempts and returns 0,
 * same "warn and continue, don't crash" tolerance as loadSnapshot() in
 * persistence.ts -- a replica that can't reach its primary at startup
 * should still come up and serve reads/replicated writes once the
 * primary is reachable, not refuse to start.
 */
export async function syncFromPrimary(
  store: CacheStore,
  primaryUrl: string,
  maxAttempts = 5,
  retryDelayMs = 1000,
): Promise<number> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${primaryUrl}/snapshot`);
      if (!res.ok) throw new Error(`primary returned HTTP ${res.status}`);
      const body = (await res.json()) as {
        keys: Array<{ key: string; value: string; ttl: number | null }>;
      };
      for (const entry of body.keys) {
        store.set(entry.key, entry.value, { ttl: entry.ttl ?? undefined });
      }
      return body.keys.length;
    } catch (err) {
      const isLastAttempt = attempt === maxAttempts;
      console.warn(
        `[inkcache] sync from primary ${primaryUrl} failed (attempt ${attempt}/${maxAttempts}): ` +
          `${(err as Error).message}${isLastAttempt ? " -- starting empty" : ""}`,
      );
      if (isLastAttempt) return 0;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  return 0;
}
