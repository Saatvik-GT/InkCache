import type { EvictionPolicy } from "../core/cache.js";

const VALID_EVICTION_POLICIES: readonly EvictionPolicy[] = ["lru", "access-aware", "lfu"];

/**
 * Validates INKCACHE_EVICTION_POLICY, falling back (with a warning) to
 * "access-aware" for anything that isn't one of the three known policies.
 * Pulled out of app.ts as a pure function for the same reason
 * resolveCorsOrigins was: unit-testable without spinning up the whole
 * Express app or reloading env-var-dependent module state.
 */
export function resolveEvictionPolicy(envValue: string | undefined): EvictionPolicy {
  if (envValue === undefined) return "access-aware";
  if ((VALID_EVICTION_POLICIES as readonly string[]).includes(envValue)) {
    return envValue as EvictionPolicy;
  }
  console.warn(
    `[inkcache] INKCACHE_EVICTION_POLICY="${envValue}" is not "lru", "access-aware", or "lfu" — using default access-aware`,
  );
  return "access-aware";
}

/**
 * Parses a positive-integer env var, falling back (with a warning) on
 * anything that isn't one. An unset var is the expected/silent case; a var
 * that IS set but to garbage (a typo, an empty string, "abc") is probably a
 * mistake worth flagging rather than silently misbehaving — Number("abc")
 * is NaN, and every `size >= NaN` comparison is false, so an unvalidated
 * NaN maxEntries would mean eviction never triggers at all.
 */
export function parsePositiveInt(
  envValue: string | undefined,
  fallback: number,
  varName: string,
  max?: number,
): number {
  if (envValue === undefined) return fallback;
  const n = Number(envValue);
  if (!Number.isInteger(n) || n <= 0 || (max !== undefined && n > max)) {
    console.warn(
      `[inkcache] ${varName}="${envValue}" is not a positive integer${max !== undefined ? ` <= ${max}` : ""} — using default ${fallback}`,
    );
    return fallback;
  }
  return n;
}
