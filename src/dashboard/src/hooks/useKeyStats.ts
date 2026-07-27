import { useEffect, useState } from "react";
import { fetchKeyStats, type KeyStat } from "../lib/api";

/**
 * Fetches per-key stats whenever refreshToken changes, with cancellation so
 * a stale in-flight response can't clobber a newer one. Shared by KeysPanel
 * and TopKeysChart, which both need the same list from two different views.
 */
export function useKeyStats(refreshToken: number): KeyStat[] | null {
  const [stats, setStats] = useState<KeyStat[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchKeyStats()
      .then((res) => {
        if (!cancelled) setStats(res.keys);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  return stats;
}
