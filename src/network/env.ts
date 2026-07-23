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
): number {
  if (envValue === undefined) return fallback;
  const n = Number(envValue);
  if (!Number.isInteger(n) || n <= 0) {
    console.warn(
      `[inkcache] ${varName}="${envValue}" is not a positive integer — using default ${fallback}`,
    );
    return fallback;
  }
  return n;
}
