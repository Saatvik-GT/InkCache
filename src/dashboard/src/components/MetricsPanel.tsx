import type { NodeMetrics } from "../lib/api";
import { Panel } from "./Panel";

/** 24-cell phosphor meter: █ lit, ░ unlit. Value clamped to [0,1]. */
function Meter({ ratio }: { ratio: number }) {
  const cells = 24;
  const lit = Math.round(Math.min(1, Math.max(0, ratio)) * cells);
  return (
    <span aria-hidden className="text-phos">
      {"█".repeat(lit)}
      <span className="text-phos-faint">{"░".repeat(cells - lit)}</span>
    </span>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-[0.2em] text-phos-mid">{label}</span>
      <span className="glow text-base text-phos-bright">
        {value}
        {unit && <span className="ml-1 text-xs text-phos-mid">{unit}</span>}
      </span>
    </div>
  );
}

function fmtUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m${String(s).padStart(2, "0")}s`;
}

export function MetricsPanel({ metrics }: { metrics: NodeMetrics }) {
  const hitRate = metrics.hitRate;
  const fill = metrics.maxEntries > 0 ? metrics.keys / metrics.maxEntries : 0;

  return (
    <Panel title="METRICS" right={`node ${metrics.node}`}>
      <div className="flex flex-col gap-4">
        {/* headline: hit rate as the number that matters */}
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-phos-mid">hit rate</div>
            <div className="glow text-3xl font-bold text-phos-bright">
              {hitRate === null ? "--.-" : (hitRate * 100).toFixed(1)}
              <span className="text-lg">%</span>
            </div>
          </div>
          <div className="pb-1 text-xs">
            <Meter ratio={hitRate ?? 0} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Stat label="ops/s" value={metrics.opsPerSec.toFixed(1)} />
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
          <Stat label="hits" value={String(metrics.hits)} />
          <Stat label="misses" value={String(metrics.misses)} />
          <Stat label="sets" value={String(metrics.sets)} />
          <Stat label="evictions" value={String(metrics.evictions)} />
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span className="text-[10px] uppercase tracking-[0.2em] text-phos-mid">store</span>
          <Meter ratio={fill} />
          <span className="text-phos">
            {metrics.keys}/{metrics.maxEntries} keys
          </span>
        </div>
      </div>
    </Panel>
  );
}
