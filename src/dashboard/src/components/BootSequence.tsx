import { useEffect, useState } from "react";

const LINES = [
  "INKCACHE POST // rev 0.1",
  "phosphor tube ................ OK",
  "mem check 512 slots .......... OK",
  "eviction policy .............. LRU",
  "ttl sweeper .................. ARMED",
  "kv console ................... READY",
  "op stream .................... READY",
  "establishing link :8080 ...... UP",
  "",
  "boot complete_",
];

const LINE_MS = 150;
const HOLD_MS = 450;

/**
 * One-shot POST-screen boot animation. Functional motion only: it plays
 * once on load and any key or click skips it.
 */
export function BootSequence({ onDone }: { onDone: () => void }) {
  const [shown, setShown] = useState(1);

  useEffect(() => {
    if (shown < LINES.length) {
      const t = setTimeout(() => setShown((n) => n + 1), LINE_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(onDone, HOLD_MS);
    return () => clearTimeout(t);
  }, [shown, onDone]);

  useEffect(() => {
    const skip = () => onDone();
    window.addEventListener("keydown", skip);
    window.addEventListener("mousedown", skip);
    return () => {
      window.removeEventListener("keydown", skip);
      window.removeEventListener("mousedown", skip);
    };
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-50 bg-crt-deep p-6 sm:p-10">
      <div className="text-sm leading-6 text-phos">
        {LINES.slice(0, shown).map((line, i) => (
          <div key={i} className={i === 0 ? "glow font-bold text-phos-bright" : ""}>
            {line}
            {i === shown - 1 && <span className="cursor-blink">█</span>}
          </div>
        ))}
      </div>
      <div className="mt-6 text-xs text-phos-dim">press any key to skip</div>
    </div>
  );
}
