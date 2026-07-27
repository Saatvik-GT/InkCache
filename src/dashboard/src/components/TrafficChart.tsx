import type { MetricsSample } from "../hooks/useNode";
import { AsciiPanel } from "./AsciiPanel";
import { LineChart } from "./LineChart";

/** Shared empty state for both charts below, before enough samples exist. */
function Collecting({ title }: { title: string }) {
  return (
    <AsciiPanel title={title} right="collecting" className="h-full">
      <p className="py-10 text-center text-xs text-dim">
        collecting samples<span className="cursor-blink">_</span>
      </p>
    </AsciiPanel>
  );
}

/** Clock labels sampled across the window, oldest to newest. */
function timeLabels(history: MetricsSample[], count = 5): string[] {
  if (history.length === 0) return [];
  return Array.from({ length: count }, (_, i) => {
    const idx = Math.round((i / (count - 1)) * (history.length - 1));
    return new Date(history[idx]!.at).toLocaleTimeString("en-GB", {
      hour12: false,
      minute: "2-digit",
      second: "2-digit",
    });
  });
}

/**
 * Cumulative hits against misses. Both are counts in the same unit, so
 * they share an axis honestly — the gap between the traces is the hit rate
 * made visible over time.
 */
export function TrafficChart({ history }: { history: MetricsSample[] }) {
  const latest = history[history.length - 1];

  if (history.length < 2 || !latest) return <Collecting title="hits vs misses" />;

  return (
    <AsciiPanel
      title="hits vs misses"
      accent
      right={`${history.length}s window`}
      className="h-full"
    >
      {/* The chart itself is aria-hidden (no discrete text content); this
          is what a screen reader gets instead. */}
      <p className="sr-only">
        {latest.hits} hits, {latest.misses} misses over the last {history.length} seconds.
      </p>
      <LineChart
        rows={12}
        cols={82}
        xLabels={timeLabels(history)}
        format={(v) => v.toFixed(0)}
        series={[
          { label: "hits", values: history.map((h) => h.hits), tone: "text-kind-hit" },
          { label: "misses", values: history.map((h) => h.misses), tone: "text-kind-miss" },
        ]}
      />
    </AsciiPanel>
  );
}

/** Latency percentiles — different unit from the counters, so its own axis. */
export function LatencyChart({ history }: { history: MetricsSample[] }) {
  const latest = history[history.length - 1];

  if (history.length < 2 || !latest) return <Collecting title="latency (µs)" />;

  return (
    <AsciiPanel title="latency (µs)" right="avg / p95" className="h-full">
      <p className="sr-only">
        {latest.avgUs === null ? "no" : latest.avgUs.toFixed(0)} microsecond average latency,
        {latest.p95Us === null ? " no" : ` ${latest.p95Us.toFixed(0)}`} microsecond p95.
      </p>
      <LineChart
        rows={12}
        cols={52}
        xLabels={timeLabels(history, 3)}
        format={(v) => v.toFixed(0)}
        series={[
          { label: "p95", values: history.map((h) => h.p95Us), tone: "text-kind-set" },
          { label: "avg", values: history.map((h) => h.avgUs), tone: "text-kind-del" },
        ]}
      />
    </AsciiPanel>
  );
}
