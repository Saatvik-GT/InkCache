import { useSyncExternalStore } from "react";
import { playBlip } from "./sound";

/**
 * Tiny append-only event store for the log stream. Kept outside React so any
 * code path (console ops, pollers, the simulator) can emit events without
 * prop-drilling callbacks.
 */

export type LogKind = "hit" | "miss" | "set" | "del" | "evict" | "expire" | "err";

export interface LogEvent {
  id: number;
  at: number; // epoch ms
  kind: LogKind;
  text: string;
}

const CAP = 200; // ring: keep the stream cheap to render

let events: LogEvent[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

export function logEvent(kind: LogKind, text: string): void {
  events = [...events.slice(-(CAP - 1)), { id: nextId++, at: Date.now(), kind, text }];
  listeners.forEach((fn) => fn());
  playBlip(kind);
}

export function clearLog(): void {
  events = [];
  listeners.forEach((fn) => fn());
}

export function useLogEvents(): LogEvent[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => events,
  );
}
