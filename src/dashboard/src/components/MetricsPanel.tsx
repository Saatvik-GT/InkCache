import type { NodeMetrics } from "../lib/api";
import type { MetricsSample } from "../hooks/useNode";
import { HitRateGauge } from "./HitRateGauge";
import { Panel } from "./Panel";
import { Sparkline } from "./Sparkline";

function StatTile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="neu-inset-sm flex flex-col gap-0.5 rounded-xl px-3 py-2">
      <span className="text-[9px] tracking-[0.18em] text-ink-mid uppercase">{label}</span>
      <span className="text-sm font-bold text-ink">
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-ink-mid">{unit}</span>}
      </span>
    </div>
  );
}

/** Linear fill meter — sunken track, accent-filled bar for a 0..1 ratio. */
function Bar({ ratio }: { ratio: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  return (
    <div className="neu-inset-sm h-3 flex-1 overflow-hidden rounded-full">
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function fmtUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m${String(s).padStart(2, "0")}s`;
}

export function MetricsPanel({
  metrics,
  history,
  stale = false,
}: {
  metrics: NodeMetrics;
  history: MetricsSample[];
  /** True when the node stopped answering: keep last-known numbers, dimmed. */
  stale?: boolean;
}) {
  const fill = metrics.maxEntries > 0 ? metrics.keys / metrics.maxEntries : 0;

  return (
    <Panel
      title="METRICS"
      right={stale ? <span className="text-kind-miss">stale — last known</span> : `node ${metrics.node}`}
    >
      <div className={`flex flex-col gap-4 ${stale ? "opacity-50" : ""}`}>
        <div className="flex items-center gap-5">
          <HitRateGauge ratio={metrics.hitRate} />
          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3">
            <StatTile label="ops/s" value={metrics.opsPerSec.toFixed(1)} />
            <StatTile
              label="lat avg"
              value={metrics.latency.avgUs === null ? "--" : metrics.latency.avgUs.toFixed(0)}
              unit="µs"
            />
            <StatTile
              label="lat p95"
              value={metrics.latency.p95Us === null ? "--" : metrics.latency.p95Us.toFixed(0)}
              unit="µs"
            />
            <StatTile label="uptime" value={fmtUptime(metrics.uptimeSec)} />
            <StatTile label="sets" value={String(metrics.sets)} />
            <StatTile label="evictions" value={String(metrics.evictions)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Sparkline label="ops/s" data={history.map((h) => h.opsPerSec)} />
          <Sparkline
            label="hit rate"
            data={history.map((h) => (h.hitRate === null ? null : h.hitRate * 100))}
            color="var(--color-kind-hit)"
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[10px] tracking-[0.18em] text-ink-mid uppercase">store</span>
          <Bar ratio={fill} />
          <span className="shrink-0 text-xs text-ink-mid">
            {metrics.keys}/{metrics.maxEntries}
          </span>
        </div>
      </div>
    </Panel>
  );
}
