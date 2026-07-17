import { useSyncExternalStore } from "react";
import { deleteKey, getKey, setKey } from "./api";
import { logEvent } from "./log";

/**
 * Demo traffic generator. Fires *real* requests at the node (nothing is
 * mocked): mostly reads over a skewed key population — like production
 * traffic, a few keys are hot — so hit rate, evictions and TTL expiry
 * all emerge from actual cache behaviour.
 */

const POOL = 64; // distinct sim keys
const TICK_MS = 280;

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
    if (roll < 0.68) {
      const res = await getKey(key);
      logEvent(res.hit ? "hit" : "miss", `${key} (sim)`);
    } else if (roll < 0.96) {
      // ~1 in 3 writes get a short TTL so expiry shows up in the demo
      const ttl = Math.random() < 0.33 ? 6 + Math.floor(Math.random() * 20) : undefined;
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
  return { running, toggle: () => (timer ? stopSimulator() : startSimulator()) };
}
