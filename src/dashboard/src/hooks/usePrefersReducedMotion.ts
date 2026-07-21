import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** Live-tracks the OS-level motion preference — not just read once on
    mount, so toggling it in system settings updates the app immediately. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(QUERY);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(QUERY).matches,
  );
}
