/**
 * Circular hit-rate gauge: a sunken ring track with an accent-lit progress
 * arc drawn on top. The arc length is the real hitRate from /metrics — this
 * isn't a decorative dial, it's the same number MetricsPanel's stat tiles
 * show, just given a shape a glance can read.
 */
export function HitRateGauge({ ratio }: { ratio: number | null }) {
  const size = 132;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = ratio === null ? 0 : Math.min(1, Math.max(0, ratio));
  const offset = c * (1 - pct);

  return (
    <div
      className="neu-inset relative grid shrink-0 place-items-center rounded-full"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-shadow-dark)"
          strokeWidth={stroke}
          strokeOpacity={0.5}
        />
        {ratio !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 500ms ease" }}
          />
        )}
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="glow-text text-2xl font-bold text-accent">
          {ratio === null ? "--" : Math.round(pct * 100)}
          {ratio !== null && <span className="text-sm">%</span>}
        </span>
        <span className="text-[9px] tracking-widest text-ink-mid uppercase">hit rate</span>
      </div>
    </div>
  );
}
