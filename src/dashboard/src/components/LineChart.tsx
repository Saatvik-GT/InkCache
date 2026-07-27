import { useMemo } from "react";
import { axisTicks, plotSeries } from "../lib/asciiPlot";

export interface ChartSeries {
  label: string;
  values: Array<number | null>;
  /** Tailwind text colour class. */
  tone: string;
}

/**
 * A plotted chart with real axes. Each series rasterizes to its own grid
 * and the grids are stacked as absolutely-positioned layers — that's what
 * allows per-series colour, which a single merged character grid couldn't
 * give (one grid, one colour).
 *
 * All series share one set of bounds so they're actually comparable; the
 * whole point of overlaying them is defeated if each gets its own scale.
 */
export function LineChart({
  series,
  cols = 76,
  rows = 12,
  xLabels = [],
  format = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)),
  min,
  max,
}: {
  series: ChartSeries[];
  cols?: number;
  rows?: number;
  xLabels?: string[];
  format?: (v: number) => string;
  min?: number;
  max?: number;
}) {
  const { layers, ticks } = useMemo(() => {
    const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
    const lo = min ?? (all.length ? Math.min(...all, 0) : 0);
    const hi = max ?? (all.length ? Math.max(...all) : 1);

    const layers = series.map((s) => ({
      ...s,
      text: plotSeries(s.values, { cols, rows, min: lo, max: hi }).text,
    }));
    // One label every other row keeps the axis readable at small type.
    return { layers, ticks: axisTicks(lo, hi, rows) };
  }, [series, cols, rows, min, max]);

  const gutter = Math.max(...ticks.map((t) => format(t).length));

  return (
    // The whole plot is glyphs with no discrete text content — hidden from
    // screen readers rather than read aloud as noise. Callers that know
    // what the chart means (e.g. TrafficChart) should pair this with a
    // sr-only summary of their own.
    <div aria-hidden className="ascii-grid overflow-hidden text-[10px] leading-none">
      <div className="flex">
        {/* Y axis */}
        <div className="shrink-0 text-right text-faint">
          {ticks.map((t, i) => (
            <div key={i}>{i % 2 === 0 ? format(t).padStart(gutter) : " ".repeat(gutter)}</div>
          ))}
        </div>
        <div className="shrink-0 text-ghost">
          {ticks.map((_, i) => (
            <div key={i}>│</div>
          ))}
        </div>

        {/* Plot area — one transparent layer per series, stacked */}
        <div className="relative min-w-0 flex-1">
          {layers.map((l) => (
            <pre key={l.label} className={`absolute inset-0 m-0 ${l.tone}`}>
              {l.text}
            </pre>
          ))}
          {/* Sizes the box; the layers above are what's actually visible. */}
          <pre className="invisible m-0">{layers[0]?.text ?? " "}</pre>
        </div>
      </div>

      <div className="flex text-ghost">
        <span className="shrink-0">{" ".repeat(gutter)}└</span>
        <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">{"─".repeat(cols)}</span>
      </div>

      {xLabels.length > 0 && (
        <div className="flex text-faint">
          <span className="shrink-0">{" ".repeat(gutter + 1)}</span>
          <span className="flex min-w-0 flex-1 justify-between">
            {xLabels.map((l, i) => (
              <span key={i}>{l}</span>
            ))}
          </span>
        </div>
      )}

      {series.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-x-3" style={{ paddingLeft: `${gutter + 1}ch` }}>
          {series.map((s) => (
            <span key={s.label} className={s.tone}>
              ■ {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
