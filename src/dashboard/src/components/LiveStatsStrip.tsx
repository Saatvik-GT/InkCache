import type { NodeMetrics } from "../lib/api";
import type { NodeStatus } from "../hooks/useNode";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="neu-inset-sm flex flex-col items-center gap-0.5 rounded-md px-4 py-2">
      <span className="text-lg font-bold text-ink">{value}</span>
      <span className="text-[9px] tracking-[0.18em] text-ink-mid uppercase">{label}</span>
    </div>
  );
}

function fmtUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m`;
}

/**
 * Real numbers from the running node, right on the landing page — proof
 * this isn't just marketing copy before you even click through to the
 * dashboard. Shows a live/offline state instead of guessing at zeros.
 */
export function LiveStatsStrip({
  metrics,
  status,
}: {
  metrics: NodeMetrics | null;
  status: NodeStatus;
}) {
  if (status !== "online" || !metrics) {
    return (
      <div className="neu-inset rounded-md px-4 py-3 text-center text-xs text-ink-mid">
        {status === "connecting"
          ? "-- connecting to local node --"
          : "-- node offline: start it with npm run dev:node to see live numbers --"}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap justify-center gap-3">
      <Stat
        label="hit rate"
        value={metrics.hitRate === null ? "--" : `${Math.round(metrics.hitRate * 100)}%`}
      />
      <Stat label="ops/s" value={metrics.opsPerSec.toFixed(1)} />
      <Stat label="keys" value={String(metrics.keys)} />
      <Stat label="uptime" value={fmtUptime(metrics.uptimeSec)} />
    </div>
  );
}
