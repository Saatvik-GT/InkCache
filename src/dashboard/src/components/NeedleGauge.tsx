/**
 * Analog dial: a half-circle sunken track, a lit progress arc, and a real
 * rotating needle — hand-built with trig, not a chart-library gauge widget.
 * Deliberately a different shape language than HitRateGauge's full ring so
 * the metrics panel doesn't repeat the same widget twice.
 */
export function NeedleGauge({
  value,
  max,
  label,
  unit,
}: {
  value: number;
  max: number;
  label: string;
  unit?: string;
}) {
  const w = 140;
  const h = 82;
  const cx = w / 2;
  const cy = 72;
  const r = 58;
  const stroke = 10;
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;

  const c = Math.PI * r; // half the circumference — this is a 180° arc, not a full ring
  const offset = c * (1 - ratio);

  // ratio 0 -> needle points left (180°); ratio 1 -> needle points right (0°)
  const angleDeg = 180 - ratio * 180;
  const angleRad = (angleDeg * Math.PI) / 180;
  const needleLen = r - stroke / 2 - 4;
  const nx = cx + needleLen * Math.cos(angleRad);
  const ny = cy - needleLen * Math.sin(angleRad);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const a = (180 - t * 180) * (Math.PI / 180);
    const inner = r - stroke - 3;
    const outer = r - stroke + 3;
    return {
      x1: cx + inner * Math.cos(a),
      y1: cy - inner * Math.sin(a),
      x2: cx + outer * Math.cos(a),
      y2: cy - outer * Math.sin(a),
    };
  });

  return (
    <div className="neu-inset-sm flex flex-col items-center gap-1 rounded-md px-2 py-2">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="var(--color-shadow-dark)"
          strokeWidth={stroke}
          strokeOpacity={0.45}
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="var(--color-kind-set)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 400ms ease" }}
        />
        {ticks.map((t, i) => (
          <line
            key={i}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke="var(--color-ink-faint)"
            strokeWidth={1.5}
          />
        ))}
        <line
          x1={cx}
          y1={cy}
          x2={nx}
          y2={ny}
          stroke="var(--color-ink)"
          strokeWidth={2.5}
          strokeLinecap="round"
          style={{ transition: "all 400ms ease" }}
        />
        <circle cx={cx} cy={cy} r={4} fill="var(--color-ink)" />
      </svg>
      <div className="-mt-2 flex flex-col items-center">
        <span className="text-xs font-bold text-ink">
          {value.toFixed(1)}
          {unit && <span className="ml-0.5 text-[9px] font-normal text-ink-mid">{unit}</span>}
        </span>
        <span className="text-[9px] tracking-[0.15em] text-ink-mid uppercase">{label}</span>
      </div>
    </div>
  );
}
