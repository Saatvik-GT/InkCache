import { useSyncExternalStore } from "react";
import type { LogKind } from "./log";

/**
 * Synthesized op-stream blips — square-wave oscillator tones generated on
 * the fly via Web Audio, one per event kind. No audio files, no library.
 * Off by default (nobody asked for sound); persisted in localStorage once
 * toggled so the choice survives a reload.
 */

const FREQ_HZ: Record<LogKind, number> = {
  hit: 880,
  set: 587,
  del: 466,
  miss: 330,
  expire: 330,
  evict: 220,
  err: 165,
};

const STORAGE_KEY = "inkcache:sound-enabled";

let enabled = typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1";
let ctx: AudioContext | null = null;
const listeners = new Set<() => void>();

function getContext(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    // Autoplay policy or no Web Audio support — sound is a nicety, fail silent.
    return null;
  }
}

/** Play a short square-wave blip for the given event kind, if sound is on. */
export function playBlip(kind: LogKind): void {
  if (!enabled) return;
  const audioCtx = getContext();
  if (!audioCtx) return;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "square";
  osc.frequency.value = FREQ_HZ[kind] ?? 440;

  const now = audioCtx.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.13);
}

export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(next: boolean): void {
  enabled = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // localStorage can throw in private-browsing contexts — the preference
    // just won't persist across reloads, which is fine.
  }
  listeners.forEach((fn) => fn());
}

export function useSoundEnabled(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => enabled,
  );
}
