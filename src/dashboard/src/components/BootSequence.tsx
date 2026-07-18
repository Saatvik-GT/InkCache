import { useEffect, useState } from "react";

const DURATION_MS = 1400;

/**
 * One-shot power-on sequence: a sunken ring fills once while the node link
 * comes up, then hands off to the dashboard. Any key or click skips it
 * straight through — this is a functional loading beat, not a loop.
 */
export function BootSequence({ onDone }: { onDone: () => void }) {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPct(1);
      onDone();
      return;
    }
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / DURATION_MS);
      setPct(p);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setTimeout(onDone, 200);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onDone]);

  useEffect(() => {
    const skip = () => onDone();
    window.addEventListener("keydown", skip);
    window.addEventListener("mousedown", skip);
    return () => {
      window.removeEventListener("keydown", skip);
      window.removeEventListener("mousedown", skip);
    };
  }, [onDone]);

  const size = 120;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  return (
    <div className="neu-field fixed inset-0 z-50 grid place-items-center">
      <div className="flex flex-col items-center gap-5">
        <div
          className="neu-inset relative grid place-items-center rounded-full"
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
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - pct)}
            />
          </svg>
          <span className="absolute text-sm font-bold text-accent">{Math.round(pct * 100)}%</span>
        </div>
        <div className="text-center">
          <div className="text-sm font-bold tracking-[0.3em] text-ink">INKCACHE</div>
          <div className="mt-1 text-xs text-ink-mid">establishing link :8080…</div>
        </div>
        <div className="text-[10px] text-ink-faint">click or press any key to skip</div>
      </div>
    </div>
  );
}
