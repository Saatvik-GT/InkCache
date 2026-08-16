/**
 * Real end-to-end replication test: spawns two actual InkCache server
 * processes (a primary and a replica pointed at it via
 * INKCACHE_PRIMARY_URL) and drives them over real HTTP, the same way
 * scripts/benchmark-external.ts spawns a real node to benchmark rather
 * than importing app.ts in-process. Necessary here specifically because
 * app.ts's ROLE/REPLICA_URLS/PRIMARY_URL are read from process.env once
 * at module load -- two roles in the same test process would mean two
 * different env-var configurations of the same already-loaded module,
 * which isn't possible without a much larger refactor of a file every
 * other test in this suite already depends on being a plain singleton.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";

const PRIMARY_PORT = 8091;
const REPLICA_PORT = 8092;
const PRIMARY_URL = `http://localhost:${PRIMARY_PORT}`;
const REPLICA_URL = `http://localhost:${REPLICA_PORT}`;

function waitForHealth(base: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  return (async function poll(): Promise<void> {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() - start > timeoutMs) throw new Error(`node at ${base} never became healthy`);
    await new Promise((r) => setTimeout(r, 150));
    return poll();
  })();
}

function waitForExit(proc: ChildProcess, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Polls until `check` returns true or gives up -- for asserting on
    eventually-consistent replicated state (forwardToReplicas() is
    fire-and-forget, so a freshly-set key isn't guaranteed visible on
    the replica the instant /set responds on the primary). */
async function waitUntil(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("condition never became true");
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("primary-replica replication (real processes)", () => {
  let primary: ChildProcess;
  let replica: ChildProcess;

  after(async () => {
    primary?.kill();
    replica?.kill();
    await Promise.all([primary && waitForExit(primary), replica && waitForExit(replica)]);
  });

  it("replicates writes from the primary to the replica over real HTTP", async () => {
    primary = spawn(process.execPath, ["--import", "tsx", "src/network/server.ts"], {
      env: {
        ...process.env,
        INKCACHE_PORT: String(PRIMARY_PORT),
        INKCACHE_NODE_ID: "test-primary",
        INKCACHE_REPLICA_URLS: REPLICA_URL,
      },
      stdio: "ignore",
    });
    await waitForHealth(PRIMARY_URL);

    replica = spawn(process.execPath, ["--import", "tsx", "src/network/server.ts"], {
      env: {
        ...process.env,
        INKCACHE_PORT: String(REPLICA_PORT),
        INKCACHE_NODE_ID: "test-replica",
        INKCACHE_ROLE: "replica",
        INKCACHE_PRIMARY_URL: PRIMARY_URL,
      },
      stdio: "ignore",
    });
    await waitForHealth(REPLICA_URL);

    // Seed the primary *before* the replica exists to prove the startup
    // snapshot pull works, not just the live-op forwarding path.
    await fetch(`${PRIMARY_URL}/set`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "seeded", value: "from-startup-sync" }),
    });

    // Re-point the replica's sync at a primary that already has data --
    // restart it so its startup sync actually runs against seeded state.
    replica.kill();
    await waitForExit(replica);
    replica = spawn(process.execPath, ["--import", "tsx", "src/network/server.ts"], {
      env: {
        ...process.env,
        INKCACHE_PORT: String(REPLICA_PORT),
        INKCACHE_NODE_ID: "test-replica",
        INKCACHE_ROLE: "replica",
        INKCACHE_PRIMARY_URL: PRIMARY_URL,
      },
      stdio: "ignore",
    });
    await waitForHealth(REPLICA_URL);

    const seededRes = await fetch(`${REPLICA_URL}/get/seeded`);
    assert.equal(seededRes.status, 200);
    const seededBody = (await seededRes.json()) as { value: string };
    assert.equal(
      seededBody.value,
      "from-startup-sync",
      "startup snapshot pull didn't load pre-existing data",
    );

    // Now prove live forwarding: a write to the primary after both nodes
    // are up should show up on the replica without a restart.
    await fetch(`${PRIMARY_URL}/set`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "live", value: "forwarded", ttl: 300 }),
    });
    await waitUntil(async () => {
      const res = await fetch(`${REPLICA_URL}/get/live`);
      return res.status === 200;
    });
    const liveRes = await fetch(`${REPLICA_URL}/get/live`);
    const liveBody = (await liveRes.json()) as { value: string; ttl: number };
    assert.equal(liveBody.value, "forwarded");
    assert.ok(liveBody.ttl > 0 && liveBody.ttl <= 300);

    // Delete forwards too.
    await fetch(`${PRIMARY_URL}/delete/live`, { method: "DELETE" });
    await waitUntil(async () => {
      const res = await fetch(`${REPLICA_URL}/get/live`);
      return res.status === 404;
    });

    // A replica rejects direct client writes.
    const rejected = await fetch(`${REPLICA_URL}/set`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "should-not-land", value: "x" }),
    });
    assert.equal(rejected.status, 409);
    const notOnPrimary = await fetch(`${PRIMARY_URL}/get/should-not-land`);
    assert.equal(notOnPrimary.status, 404);

    // Both nodes report their role.
    const primaryHealth = (await (await fetch(`${PRIMARY_URL}/health`)).json()) as { role: string };
    const replicaHealth = (await (await fetch(`${REPLICA_URL}/health`)).json()) as { role: string };
    assert.equal(primaryHealth.role, "primary");
    assert.equal(replicaHealth.role, "replica");

    // Manual promotion: POST /promote flips the replica to a primary
    // without a restart, and it immediately starts accepting the
    // writes it was rejecting a moment ago.
    const promoteRes = await fetch(`${REPLICA_URL}/promote`, { method: "POST" });
    assert.equal(promoteRes.status, 200);
    const promoteBody = (await promoteRes.json()) as { ok: boolean; role: string };
    assert.equal(promoteBody.role, "primary");

    const afterPromotion = await fetch(`${REPLICA_URL}/set`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "post-promotion", value: "accepted" }),
    });
    assert.equal(
      afterPromotion.status,
      200,
      "the newly-promoted node still rejected a direct write",
    );

    const rolesAfter = (await (await fetch(`${REPLICA_URL}/health`)).json()) as { role: string };
    assert.equal(rolesAfter.role, "primary");

    // Promoting an already-primary node is rejected, not silently accepted.
    const doublePromote = await fetch(`${REPLICA_URL}/promote`, { method: "POST" });
    assert.equal(doublePromote.status, 409);
  });
});
