/**
 * Process entrypoint: binds the Express app from app.ts to a port and wires
 * up the TTL sweeper and graceful shutdown.
 */

import { app, store } from "./app.js";

const PORT = Number(process.env.INKCACHE_PORT ?? 8080);
const MAX_ENTRIES = Number(process.env.INKCACHE_MAX_ENTRIES ?? 512);
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
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
