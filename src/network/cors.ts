/** Local dev origins are always allowed, regardless of config. */
export const DEFAULT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

/**
 * Parses INKCACHE_CORS_ORIGIN (comma-separated, arbitrary whitespace around
 * entries, blank entries dropped) and merges it with the always-allowed
 * local dev origins. Pulled out of app.ts as a pure function specifically
 * so the parsing edge cases (empty, trailing commas, stray whitespace) are
 * unit-testable without spinning up the whole Express app.
 */
export function resolveCorsOrigins(envValue: string | undefined): string[] {
  const extra =
    envValue
      ?.split(",")
      .map((o) => o.trim())
      .filter(Boolean) ?? [];
  return [...DEFAULT_ORIGINS, ...extra];
}
