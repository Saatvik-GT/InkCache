import type { NodeMetrics } from "../lib/api";
import type { MetricsSample } from "../hooks/useNode";
import { AsciiPanel } from "./AsciiPanel";
import { renderMeter, renderSparkline } from "../lib/asciiChart";

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] tracking-[0.18em] text-faint uppercase">{label}</span>
      <span className="text-sm text-bright">
        {value}
        {unit && <span className="ml-1 text-[10px] text-dim">{unit}</span>}
      </span>
    </div>
  );
}

function Trend({
  label,
  data,
  tone = "text-dim",
  format,
}: {
  label: string;
  data: Array<number | null>;
  tone?: string;
  format?: (v: number) => string;
}) {
  const present = data.filter((v): v is number => v !== null);
  const latest = present.length > 0 ? present[present.length - 1]! : null;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[9px] tracking-[0.18em] text-faint uppercase">{label}</span>
        <span className="text-[10px] text-dim">
          {latest === null ? "--" : (format ?? ((v: number) => v.toFixed(1)))(latest)}
        </span>
      </div>
      <div className={`ascii-grid truncate text-xs ${tone}`}>{renderSparkline(data)}</div>
    </div>
  );
}

function fmtUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
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
  const hit = metrics.hitRate;

  return (
    <AsciiPanel
      title="metrics"
      right={stale ? <span className="text-kind-miss">stale — last known</span> : metrics.node}
    >
      <div className={`flex flex-col gap-4 ${stale ? "opacity-50" : ""}`}>
        {/* Hit rate is the headline number, so it gets the large type and
            its own full-width meter rather than being one tile among many. */}
        <div>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl leading-none text-bright">
              {hit === null ? "--.-" : (hit * 100).toFixed(1)}
              <span className="text-base text-dim">%</span>
            </span>
            <span className="text-[9px] tracking-[0.2em] text-faint uppercase">hit rate</span>
          </div>
          <div className="ascii-grid mt-2 truncate text-xs text-accent">
            {renderMeter(hit ?? 0, 44)}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Stat label="ops/sec" value={metrics.opsPerSec.toFixed(1)} />
          <Stat
            label="lat avg"
            value={metrics.latency.avgUs === null ? "--" : metrics.latency.avgUs.toFixed(0)}
            unit="µs"
          />
          <Stat
            label="lat p95"
            value={metrics.latency.p95Us === null ? "--" : metrics.latency.p95Us.toFixed(0)}
            unit="µs"
          />
          <Stat label="uptime" value={fmtUptime(metrics.uptimeSec)} />
          <Stat label="sets" value={String(metrics.sets)} />
          <Stat label="evictions" value={String(metrics.evictions)} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Trend label="ops/sec" data={history.map((h) => h.opsPerSec)} />
          <Trend
            label="hit rate"
            data={history.map((h) => (h.hitRate === null ? null : h.hitRate * 100))}
            tone="text-kind-hit"
            format={(v) => `${v.toFixed(0)}%`}
          />
          <Trend
            label="lat p95"
            data={history.map((h) => h.p95Us)}
            tone="text-kind-set"
            format={(v) => `${v.toFixed(0)}µs`}
          />
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-[9px] tracking-[0.18em] text-faint uppercase">store</span>
          <span className="ascii-grid min-w-0 flex-1 truncate text-dim">
            {renderMeter(fill, 28)}
          </span>
          <span className="shrink-0 text-dim">
            {metrics.keys}/{metrics.maxEntries}
          </span>
        </div>

        <div className="flex flex-wrap gap-x-4 text-[10px] text-faint">
          <span>
            policy <span className="text-dim">{metrics.evictionPolicy}</span>
          </span>
          {metrics.evictionPolicy === "access-aware" && (
            <span>
              sample <span className="text-dim">k={metrics.evictionSampleSize}</span>
            </span>
          )}
          <span>
            hits/misses{" "}
            <span className="text-dim">
              {metrics.hits}/{metrics.misses}
            </span>
          </span>
        </div>
      </div>
    </AsciiPanel>
  );
}
