import { useEffect, useState } from "react";
import { renderMeter } from "../lib/asciiChart";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

const LINES = [
  "inkcache console v0.1.0",
  "",
  "checking character grid ......... ok",
  "loading glyph tables ............ ok",
  "mounting metrics poller ......... ok",
  "opening op stream ............... ok",
  "resolving node :8080 ............ ok",
];

const LINE_MS = 110;

/**
 * POST-style boot screen. One-shot functional motion — it plays once on
 * load and any key or click skips straight through, so it never becomes
 * something you have to sit through twice.
 */
export function BootSequence({ onDone }: { onDone: () => void }) {
  const [shown, setShown] = useState(0);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      onDone();
      return;
    }
    if (shown >= LINES.length) {
      const t = setTimeout(onDone, 260);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setShown((n) => n + 1), LINE_MS);
    return () => clearTimeout(t);
  }, [shown, onDone, reducedMotion]);

  useEffect(() => {
    const skip = () => onDone();
    window.addEventListener("keydown", skip);
    window.addEventListener("mousedown", skip);
    return () => {
      window.removeEventListener("keydown", skip);
      window.removeEventListener("mousedown", skip);
    };
  }, [onDone]);

  const progress = shown / LINES.length;

  return (
    <div className="fixed inset-0 z-50 bg-void p-6 sm:p-10">
      <div className="text-xs leading-relaxed">
        {LINES.slice(0, shown).map((line, i) => (
          <div key={i} className={i === 0 ? "text-bright" : "text-text"}>
            {line}
            {i === shown - 1 && <span className="cursor-blink text-accent">█</span>}
          </div>
        ))}
        <div className="ascii-grid mt-4 text-accent">
          <span aria-hidden>{renderMeter(progress, 32)}</span> {Math.round(progress * 100)}%
        </div>
      </div>
      <div className="mt-6 text-[10px] text-faint">press any key to skip</div>
    </div>
  );
}
