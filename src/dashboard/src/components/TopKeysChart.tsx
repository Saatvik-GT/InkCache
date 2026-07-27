import { useKeyStats } from "../hooks/useKeyStats";
import { AsciiPanel } from "./AsciiPanel";
import { BarChart } from "./BarChart";

/**
 * The hottest keys by read count — the direct visual answer to "what is
 * access-aware eviction protecting right now?", which a flat key list
 * can't give you at a glance.
 */
export function TopKeysChart({ refreshToken, top = 6 }: { refreshToken: number; top?: number }) {
  const stats = useKeyStats(refreshToken);

  const bars = (stats ?? [])
    .slice()
    .sort((a, b) => b.hits - a.hits)
    .slice(0, top)
    .map((s) => ({
      // Long keys are usually prefixed (sim:user:12), so the tail is the
      // part that actually distinguishes them.
      label: s.key.length > 6 ? `…${s.key.slice(-5)}` : s.key,
      value: s.hits,
    }));

  return (
    <AsciiPanel title="hottest keys" right={stats ? `top ${bars.length}` : "--"} className="h-full">
      {stats === null ? (
        <p className="text-xs text-dim">-- no signal --</p>
      ) : bars.length === 0 ? (
        <p className="text-xs text-faint">-- store empty --</p>
      ) : (
        <BarChart bars={bars} rows={7} barWidth={5} tone="text-kind-set" />
      )}
    </AsciiPanel>
  );
}
