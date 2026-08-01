import { renderBarChart } from "../lib/asciiPlot";

export interface Bar {
  label: string;
  value: number;
}

/**
 * Vertical bars with the value printed inside the foot of each bar and the
 * label beneath — reading a bar chart off an axis alone is guesswork at
 * character resolution, so the number is always on the bar.
 */
export function BarChart({
  bars,
  rows = 8,
  barWidth = 4,
  tone = "text-kind-set",
}: {
  bars: Bar[];
  rows?: number;
  barWidth?: number;
  tone?: string;
}) {
  if (bars.length === 0) {
    return <p className="text-xs text-faint">-- no data --</p>;
  }

  const chart = renderBarChart(
    bars.map((b) => b.value),
    { rows, barWidth },
  );

  return (
    <div className="ascii-grid overflow-x-auto text-[10px] leading-none">
      <pre aria-hidden className={`m-0 ${tone}`}>
        {chart}
      </pre>
      <div className="flex gap-1 text-bright">
        {bars.map((b, i) => (
          <span key={i} className="text-center" style={{ width: `${barWidth}ch` }}>
            {String(b.value).slice(0, barWidth)}
          </span>
        ))}
      </div>
      <div className="mt-0.5 flex gap-1 text-faint">
        {bars.map((b, i) => (
          <span
            key={i}
            className="truncate text-center"
            style={{ width: `${barWidth}ch` }}
            title={b.label}
          >
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}
