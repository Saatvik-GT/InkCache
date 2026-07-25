import type { NodeMetrics } from "../lib/api";
import type { NodeStatus } from "../hooks/useNode";
import { renderMeter } from "../lib/asciiChart";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      {/* Dot leaders tie the label to its value across the gap, the way a
          printed index or a manifest does. */}
      <span className="shrink-0 text-dim">{label}</span>
      <span aria-hidden className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-ghost">
        {".".repeat(200)}
      </span>
      <span className="shrink-0 text-bright">{value}</span>
    </div>
  );
}

function fmtUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m`;
}

/**
 * Live readout from the running node — the landing page's proof that the
 * numbers aren't decoration. Distinct connecting/offline states rather
 * than showing zeros that look like real (bad) measurements.
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
      <p className="text-xs text-dim">
        {status === "connecting" ? (
          <>
            connecting to local node<span className="cursor-blink">_</span>
          </>
        ) : (
          <>
            node offline — start it with <span className="text-bright">npm run dev:node</span>
          </>
        )}
      </p>
    );
  }

  const hit = metrics.hitRate;

  return (
    <div className="max-w-sm space-y-1 text-xs">
      <Row label="node" value={metrics.node} />
      <Row label="hit rate" value={hit === null ? "--" : `${Math.round(hit * 100)}%`} />
      <Row label="ops/sec" value={metrics.opsPerSec.toFixed(1)} />
      <Row label="keys" value={`${metrics.keys}/${metrics.maxEntries}`} />
      <Row label="uptime" value={fmtUptime(metrics.uptimeSec)} />
      <div className="flex items-center gap-2 pt-1">
        <span className="text-dim">load</span>
        <span className="ascii-grid text-accent">
          {renderMeter(metrics.maxEntries > 0 ? metrics.keys / metrics.maxEntries : 0, 24)}
        </span>
      </div>
    </div>
  );
}
