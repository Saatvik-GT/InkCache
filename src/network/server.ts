/**
 * Process entrypoint: binds the Express app from app.ts to a port and wires
 * up the TTL sweeper and graceful shutdown.
 */

import { app, store, MAX_ENTRIES } from "./app.js";
import { parsePositiveInt } from "./env.js";

// PORT only matters here (app.ts never binds a port), but MAX_ENTRIES is
// imported rather than recomputed — a second, separately-unvalidated copy
// of the same env var is exactly how this file's startup log line ended up
// printing "maxEntries=NaN" while the store itself correctly fell back.
const PORT = parsePositiveInt(process.env.INKCACHE_PORT, 8080, "INKCACHE_PORT");
const NODE_ID = process.env.INKCACHE_NODE_ID ?? "node-1";

store.startSweeper();

const server = app.listen(PORT, () => {
  console.log(
    `[inkcache] ${NODE_ID} listening on http://localhost:${PORT} ` +
      `(maxEntries=${MAX_ENTRIES}, evictionPolicy=${store.evictionPolicy})`,
  );
});

function shutdown(signal: string): void {
  console.log(`[inkcache] received ${signal}, shutting down`);
  store.stopSweeper();
  server.close(() => process.exit(0));
  // server.close() waits for in-flight connections to end on their own,
  // which can hang indefinitely on a lingering keep-alive socket. Force
  // the exit rather than risk out-waiting a host's shutdown grace period
  // (e.g. Docker's default 10s before SIGKILL) and getting killed mid-write.
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
