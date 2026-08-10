import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CacheStore } from "../src/core/cache.js";
import { saveSnapshot, loadSnapshot, startAutoPersist } from "../src/network/persistence.js";

/** Every test gets its own throwaway directory so parallel test files (and
    re-runs) never collide on the same persistence file. */
async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "inkcache-persist-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** startAutoPersist()'s save is real, async fs I/O fired from inside a
    mocked-timer callback -- tick() only fires the callback synchronously,
    it doesn't wait for what that callback then does. Poll instead of
    guessing how many microtask turns two sequential fs.promises calls
    (write + rename) need to actually land on disk. */
async function waitForFile(path: string, timeoutMs = 2000): Promise<string> {
  const start = Date.now();
  for (;;) {
    try {
      return await readFile(path, "utf8");
    } catch {
      if (Date.now() - start > timeoutMs) throw new Error(`${path} never appeared`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

describe("saveSnapshot() / loadSnapshot()", () => {
  it("round-trips values and ttls through a real file", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "snapshot.json");
      const store = new CacheStore();
      store.set("a", "1");
      store.set("b", "2", { ttl: 300 });

      await saveSnapshot(store, path);

      const restored = new CacheStore();
      const loaded = await loadSnapshot(restored, path);
      assert.equal(loaded, 2);
      assert.equal(restored.get("a"), "1");
      assert.equal(restored.get("b"), "2");
      const ttl = restored.ttl("b");
      assert.ok(ttl !== undefined && ttl > 0 && ttl <= 300);
    });
  });

  it("writes atomically -- no leftover .tmp file after a successful save", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "snapshot.json");
      await saveSnapshot(new CacheStore(), path);
      await assert.rejects(
        () => access(`${path}.tmp`),
        "the temp file should have been renamed away",
      );
      await access(path); // the real path should exist and be readable
    });
  });

  it("returns undefined for a file that doesn't exist, without throwing", async () => {
    await withTempDir(async (dir) => {
      const store = new CacheStore();
      const loaded = await loadSnapshot(store, join(dir, "nope.json"));
      assert.equal(loaded, undefined);
      assert.equal(store.size, 0);
    });
  });

  it("returns undefined and starts empty for invalid JSON, without throwing", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "corrupt.json");
      await writeFile(path, "{not valid json", "utf8");
      const store = new CacheStore();
      const loaded = await loadSnapshot(store, path);
      assert.equal(loaded, undefined);
      assert.equal(store.size, 0);
    });
  });

  it("returns undefined for valid JSON with no keys array", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "wrong-shape.json");
      await writeFile(path, JSON.stringify({ notKeys: [] }), "utf8");
      const store = new CacheStore();
      const loaded = await loadSnapshot(store, path);
      assert.equal(loaded, undefined);
    });
  });

  it("skips malformed individual rows but loads the valid ones", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "partial.json");
      await writeFile(
        path,
        JSON.stringify({
          keys: [
            { key: "good", value: "1", ttl: null },
            { key: "no-value" }, // missing value -- malformed
            null, // not even an object
            { key: "also-good", value: "2", ttl: null },
          ],
        }),
        "utf8",
      );
      const store = new CacheStore();
      const loaded = await loadSnapshot(store, path);
      assert.equal(loaded, 2);
      assert.equal(store.get("good"), "1");
      assert.equal(store.get("also-good"), "2");
      assert.equal(store.get("no-value"), undefined);
    });
  });

  it("treats a saved ttl:null as no expiry on load, not a rejected/broken entry", async () => {
    // Regression class: the same ttl:null-vs-undefined bug POST /restore's
    // validateEntry() had. saveSnapshot()/exportEntries() write ttl: null
    // for a no-expiry key; loadSnapshot() must accept that, not treat it
    // as an invalid ttl.
    await withTempDir(async (dir) => {
      const path = join(dir, "snapshot.json");
      await writeFile(
        path,
        JSON.stringify({ keys: [{ key: "a", value: "1", ttl: null }] }),
        "utf8",
      );
      const store = new CacheStore();
      const loaded = await loadSnapshot(store, path);
      assert.equal(loaded, 1);
      assert.equal(store.get("a"), "1");
      assert.equal(store.ttl("a"), undefined); // undefined ttl() = never expires
    });
  });
});

describe("startAutoPersist()", () => {
  it("saves on the given interval until stopped", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "auto.json");
      mock.timers.enable({ apis: ["setInterval"] });
      try {
        const store = new CacheStore();
        store.set("a", "1");
        const handle = startAutoPersist(store, path, 1000);

        mock.timers.tick(1000);
        const saved = JSON.parse(await waitForFile(path)) as { keys: unknown[] };
        assert.equal(saved.keys.length, 1);

        handle.stop();
      } finally {
        mock.timers.reset();
      }
    });
  });

  it("stop() halts further saves", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "auto.json");
      mock.timers.enable({ apis: ["setInterval"] });
      try {
        const store = new CacheStore();
        const handle = startAutoPersist(store, path, 1000);
        handle.stop();
        mock.timers.tick(5000);
        await new Promise((r) => setImmediate(r));
        await assert.rejects(
          () => access(path),
          "stop() before the first tick means nothing was ever saved",
        );
      } finally {
        mock.timers.reset();
      }
    });
  });
});
