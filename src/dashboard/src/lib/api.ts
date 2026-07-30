/**
 * Typed client for the cache node's REST API. By default calls go through
 * the /api dev proxy (see vite.config.ts), so the node's origin lives in
 * one place. Set VITE_API_BASE at build time to point a statically-hosted
 * build (e.g. on Vercel) at a backend running somewhere else entirely —
 * see .env.example.
 */
const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export interface GetResult {
  hit: boolean;
  key: string;
  value?: string;
  /** Remaining TTL in seconds, null when the key never expires. */
  ttl?: number | null;
}

export interface NodeMetrics {
  node: string;
  keys: number;
  maxEntries: number;
  evictions: number;
  evictionPolicy: "lru" | "access-aware";
  evictionSampleSize: number;
  uptimeSec: number;
  hits: number;
  misses: number;
  hitRate: number | null;
  sets: number;
  deletes: number;
  opsPerSec: number;
  latency: { avgUs: number | null; p95Us: number | null; samples: number };
}

export interface NodeHealth {
  status: string;
  node: string;
  uptimeSec: number;
  keys: number;
  timestamp: string;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${path}`, init);
}

export async function setKey(
  key: string,
  value: string,
  ttl?: number,
): Promise<{ ok: boolean; ttl: number | null }> {
  const res = await request("/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value, ttl }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `set failed (${res.status})`);
  }
  return res.json();
}

export async function getKey(key: string): Promise<GetResult> {
  const res = await request(`/get/${encodeURIComponent(key)}`);
  if (res.status === 404) return { hit: false, key };
  if (!res.ok) throw new Error(`get failed (${res.status})`);
  const body = (await res.json()) as { value?: string; ttl?: number | null };
  return { hit: true, key, value: body.value, ttl: body.ttl };
}

export async function deleteKey(key: string): Promise<{ deleted: boolean }> {
  const res = await request(`/delete/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`delete failed (${res.status})`);
  return res.json();
}

export async function fetchMetrics(): Promise<NodeMetrics> {
  const res = await request("/metrics");
  if (!res.ok) throw new Error(`metrics failed (${res.status})`);
  return res.json();
}

export async function fetchHealth(): Promise<NodeHealth> {
  const res = await request("/health");
  if (!res.ok) throw new Error(`health failed (${res.status})`);
  return res.json();
}

export async function fetchKeys(): Promise<{ keys: string[]; count: number }> {
  const res = await request("/keys");
  if (!res.ok) throw new Error(`keys failed (${res.status})`);
  return res.json();
}

export interface KeyStat {
  key: string;
  hits: number;
  ttl: number | null;
}

export async function fetchKeyStats(): Promise<{ keys: KeyStat[]; count: number }> {
  const res = await request("/keys/stats");
  if (!res.ok) throw new Error(`key stats failed (${res.status})`);
  return res.json();
}

export async function flush(): Promise<{ ok: boolean; dropped: number }> {
  const res = await request("/flush", { method: "POST" });
  if (!res.ok) throw new Error(`flush failed (${res.status})`);
  return res.json();
}

/**
 * Turns a caught fetch error into a message worth showing a user. fetch
 * throws a bare TypeError when the node itself is unreachable (DNS, refused
 * connection, CORS), as opposed to an Error we threw ourselves above for a
 * real non-2xx response — those two cases read very differently to someone
 * debugging a demo, so they're worth telling apart rather than collapsing
 * into one generic failure message.
 */
export function describeFetchError(err: unknown): string {
  if (err instanceof TypeError) return "node unreachable — is the cache node running?";
  if (err instanceof Error) return err.message;
  return String(err);
}
