/**
 * Small inset trend line for a rolling window of real samples (see
 * useNode's history). Auto-scales to the data's own range — no fixed axis,
 * this is a shape-of-the-trend readout, not a precision chart.
 */
export function Sparkline({
  data,
  label,
  color = "var(--color-accent)",
}: {
  data: (number | null)[];
  label: string;
  color?: string;
}) {
  const width = 100;
  const height = 32;
  const valid = data.filter((v): v is number => v !== null);
  const max = valid.length ? Math.max(...valid, 0.001) : 1;

  const points = data
    .map((v, i) => {
      if (v === null) return null;
      const x = data.length > 1 ? (i / (data.length - 1)) * width : width;
      const y = height - (v / max) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter((p): p is string => p !== null);

  return (
    <div className="neu-inset-sm rounded-md p-2">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[9px] tracking-widest text-ink-mid uppercase">{label}</span>
        {valid.length > 0 && (
          <span className="text-[10px] text-ink-mid">{valid[valid.length - 1]!.toFixed(1)}</span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-8 w-full"
        aria-hidden
      >
        {points.length > 1 ? (
          <polyline
            points={points.join(" ")}
            fill="none"
            stroke={color}
            strokeWidth={1.75}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : (
          <line
            x1={0}
            y1={height - 2}
            x2={width}
            y2={height - 2}
            stroke="var(--color-shadow-light)"
            strokeWidth={1}
          />
        )}
      </svg>
    </div>
  );
}
