/**
 * Turns a caught fetch error into a message worth showing a user. fetch
 * throws a bare TypeError when the node itself is unreachable (DNS, refused
 * connection, CORS), as opposed to an Error thrown for a real non-2xx
 * response — those two cases read very differently to someone debugging a
 * demo, so they're worth telling apart rather than collapsing into one
 * generic failure message.
 *
 * Kept in its own file, separate from api.ts, specifically so it has no
 * import.meta.env dependency — api.ts throws at module load time outside
 * Vite (import.meta.env is undefined there), which made this untestable
 * via plain node:test despite being a pure function with no such need.
 */
export function describeFetchError(err: unknown): string {
  if (err instanceof TypeError) return "node unreachable — is the cache node running?";
  if (err instanceof Error) return err.message;
  return String(err);
}
