import type { NodeMetrics } from "../lib/api";
import { AsciiPanel } from "./AsciiPanel";

interface Row {
  metric: string;
  value: string;
  detail: string;
  /** The one row worth leading with gets the inverted treatment. */
  highlight?: boolean;
}

function fmtUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function StatsTable({ metrics, stale = false }: { metrics: NodeMetrics; stale?: boolean }) {
  const hit = metrics.hitRate;
  const reads = metrics.hits + metrics.misses;

  const rows: Row[] = [
    {
      metric: "hit rate",
      value: hit === null ? "--" : `${(hit * 100).toFixed(1)}%`,
      detail: `${metrics.hits}/${reads}`,
      highlight: true,
    },
    { metric: "ops/sec", value: metrics.opsPerSec.toFixed(1), detail: "10s window" },
    {
      metric: "lat avg",
      value: metrics.latency.avgUs === null ? "--" : `${metrics.latency.avgUs.toFixed(0)}µs`,
      detail: `${metrics.latency.samples} samples`,
    },
    {
      metric: "lat p95",
      value: metrics.latency.p95Us === null ? "--" : `${metrics.latency.p95Us.toFixed(0)}µs`,
      detail: "ring buffer",
    },
    { metric: "hits", value: String(metrics.hits), detail: "cumulative" },
    { metric: "misses", value: String(metrics.misses), detail: "cumulative" },
    { metric: "sets", value: String(metrics.sets), detail: "cumulative" },
    { metric: "deletes", value: String(metrics.deletes), detail: "cumulative" },
    { metric: "evictions", value: String(metrics.evictions), detail: metrics.evictionPolicy },
    { metric: "uptime", value: fmtUptime(metrics.uptimeSec), detail: metrics.node },
  ];

  return (
    <AsciiPanel
      title="node counters"
      accent
      right={
        stale ? <span className="text-kind-miss">stale</span> : `k=${metrics.evictionSampleSize}`
      }
      className="h-full"
    >
      <div className={`text-[11px] ${stale ? "opacity-50" : ""}`}>
        <div className="flex gap-2 border-b border-ghost pb-1 text-[9px] tracking-[0.18em] text-dim uppercase">
          <span className="min-w-0 flex-1">metric</span>
          <span className="w-16 shrink-0 text-right">value</span>
          <span className="w-20 shrink-0 text-right">detail</span>
        </div>
        {rows.map((r) => (
          <div
            key={r.metric}
            className={`flex gap-2 py-[1px] ${
              r.highlight ? "bg-accent font-bold text-void" : "text-text"
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{r.metric}</span>
            <span className={`w-16 shrink-0 text-right ${r.highlight ? "" : "text-bright"}`}>
              {r.value}
            </span>
            <span
              className={`w-20 shrink-0 truncate text-right ${r.highlight ? "" : "text-faint"}`}
            >
              {r.detail}
            </span>
          </div>
        ))}
      </div>
    </AsciiPanel>
  );
}
