import { useEffect, useState } from "react";
import { fetchKeyStats, type KeyStat } from "../lib/api";
import { Panel } from "./Panel";

/**
 * Access-frequency heat map: each key is a tile, background intensity
 * scaled by its real hit count from /keys/stats (0 hits = base surface,
 * the hottest key in the store = full accent). Same refreshToken-driven
 * polling this panel always used — the upgrade is what it renders, not
 * how it fetches.
 */
export function KeysPanel({ refreshToken }: { refreshToken: number }) {
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

  const maxHits = stats ? Math.max(0, ...stats.map((s) => s.hits)) : 0;

  return (
    <Panel title="KEYS" right={stats ? `${stats.length} live · heat by hits` : "--"}>
      <div className="grid max-h-40 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 md:grid-cols-6">
        {stats === null ? (
          <p className="col-span-full text-ink-mid">-- no signal --</p>
        ) : stats.length === 0 ? (
          <p className="col-span-full text-ink-faint">-- store empty --</p>
        ) : (
          stats.map(({ key, hits }) => {
            const intensity = maxHits > 0 ? hits / maxHits : 0;
            return (
              <div
                key={key}
                title={`${key} — ${hits} read${hits === 1 ? "" : "s"}`}
                className="neu-inset-sm flex flex-col gap-0.5 rounded-md px-2 py-1.5"
                style={{
                  backgroundColor: `color-mix(in oklab, var(--color-accent) ${Math.round(intensity * 65)}%, var(--color-base))`,
                }}
              >
                <span className="truncate text-xs text-ink">{key}</span>
                <span className="text-[9px] text-ink-mid">{hits}h</span>
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}
