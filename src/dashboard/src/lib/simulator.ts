import { useEffect, useSyncExternalStore } from "react";
import { deleteKey, getKey, setKey } from "./api.js";
import { logEvent } from "./log.js";

/**
 * Demo traffic generator. Fires *real* requests at the node (nothing is
 * mocked): mostly reads over a skewed key population — like production
 * traffic, a few keys are hot — so hit rate, evictions and TTL expiry
 * all emerge from actual cache behaviour.
 */

const POOL = 64; // distinct sim keys
const TICK_MS = 280;

// Op mix: mostly reads, some writes, a few deletes — the two thresholds
// below split a 0..1 roll into read / write / delete bands.
const READ_PROB = 0.68;
const WRITE_PROB = 0.96; // read..write band; the rest is delete
const SHORT_TTL_PROB = 0.33; // fraction of writes that get a short TTL
const SHORT_TTL_MIN_S = 6;
const SHORT_TTL_RANGE_S = 20; // short TTL is SHORT_TTL_MIN_S..+RANGE-1 seconds

let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

/** Power-law pick: index 0 is hottest, tail is cold. */
function skewedKey(): string {
  const idx = Math.floor(POOL * Math.pow(Math.random(), 2.4));
  return `sim:user:${idx}`;
}

async function fire(): Promise<void> {
  const roll = Math.random();
  const key = skewedKey();
  try {
    if (roll < READ_PROB) {
      const res = await getKey(key);
      logEvent(res.hit ? "hit" : "miss", `${key} (sim)`);
    } else if (roll < WRITE_PROB) {
      // ~1 in 3 writes get a short TTL so expiry shows up in the demo
      const ttl =
        Math.random() < SHORT_TTL_PROB
          ? SHORT_TTL_MIN_S + Math.floor(Math.random() * SHORT_TTL_RANGE_S)
          : undefined;
      await setKey(key, `payload-${Date.now() % 100000}`, ttl);
      logEvent("set", `${key}${ttl ? ` ttl=${ttl}s` : ""} (sim)`);
    } else {
      const res = await deleteKey(key);
      if (res.deleted) logEvent("del", `${key} (sim)`);
    }
  } catch {
    logEvent("err", "sim op failed — node unreachable");
    stopSimulator();
  }
}

export function startSimulator(): void {
  if (timer) return;
  timer = setInterval(() => void fire(), TICK_MS);
  logEvent("set", "traffic simulator engaged");
  listeners.forEach((fn) => fn());
}

export function stopSimulator(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
  logEvent("del", "traffic simulator disengaged");
  listeners.forEach((fn) => fn());
}

export function useSimulator(): { running: boolean; toggle: () => void } {
  const running = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => timer !== undefined,
  );

  // The timer is module-level, not component-level — it doesn't stop on
  // its own just because the console page unmounts. Without this, leaving
  // /dashboard for / while the simulator is running would leave it firing
  // real requests in the background indefinitely, with nothing on the
  // home page to show it or turn it off.
  useEffect(() => stopSimulator, []);

  return { running, toggle: () => (timer ? stopSimulator() : startSimulator()) };
}
