import type { NodeMetrics } from "../lib/api";
import { AsciiPanel } from "./AsciiPanel";
import { renderMeter } from "../lib/asciiChart";

/**
 * Capacity readout. Store fill is the number that decides *when* eviction
 * runs at all, so it gets its own panel rather than being one row in a
 * table of counters.
 */
export function StoreGauge({ metrics, stale = false }: { metrics: NodeMetrics; stale?: boolean }) {
  const fill = metrics.maxEntries > 0 ? metrics.keys / metrics.maxEntries : 0;
  const pct = Math.round(fill * 100);
  // Amber past 80%: eviction pressure is imminent, not yet a failure.
  const tone = fill >= 0.8 ? "text-kind-miss" : "text-accent";

  return (
    <AsciiPanel
      title="store capacity"
      right={
        stale ? (
          <span className="text-kind-miss">stale</span>
        ) : (
          `${metrics.keys}/${metrics.maxEntries}`
        )
      }
      className="h-full"
    >
      <div className={`flex flex-col gap-2 ${stale ? "opacity-50" : ""}`}>
        <div className="flex items-baseline gap-2">
          <span className={`text-2xl leading-none ${tone}`}>{pct}</span>
          <span className="text-sm text-dim">%</span>
          <span className="ml-auto text-[10px] text-faint">
            {metrics.maxEntries - metrics.keys} free
          </span>
        </div>

        <div aria-hidden className={`ascii-grid truncate text-xs ${tone}`}>
          {renderMeter(fill, 32)}
        </div>

        <dl className="mt-1 space-y-0.5 text-[10px]">
          <div className="flex justify-between">
            <dt className="text-faint">policy</dt>
            <dd className="text-text">{metrics.evictionPolicy}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-faint">evicted</dt>
            <dd className="text-text">{metrics.evictions}</dd>
          </div>
        </dl>
      </div>
    </AsciiPanel>
  );
}
