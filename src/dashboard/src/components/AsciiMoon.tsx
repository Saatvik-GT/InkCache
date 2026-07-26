import { useEffect, useRef } from "react";
import { renderAsciiSphere } from "../lib/asciiSphere";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

/** Terminal-ish cadence, and a fraction of the work of a 60fps loop. */
const FPS = 24;

/**
 * The rotating ASCII body. Frames are written straight to the <pre> via a
 * ref instead of through React state — at 24fps, routing a ~2KB string
 * through reconciliation every frame is pure overhead for a node whose
 * only content is that string.
 */
export function AsciiMoon({
  // Denser grid than the body strictly needs: the extra resolution is what
  // keeps the limb reading as a smooth curve instead of a staircase.
  cols = 108,
  rows = 46,
  /** Radians per second. Callers pass a rate derived from real node traffic. */
  spinSpeed = 0.55,
  className = "",
}: {
  cols?: number;
  rows?: number;
  spinSpeed?: number;
  className?: string;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  // Held in a ref so a speed change doesn't restart the animation and snap
  // the moon back to its starting angle.
  const speedRef = useRef(spinSpeed);
  speedRef.current = spinSpeed;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (reducedMotion) {
      // A fixed, slightly-turned frame: still a lit 3D body, just not moving.
      node.textContent = renderAsciiSphere({ cols, rows, spin: 0.6 });
      return;
    }

    let raf = 0;
    let spin = 0.6;
    let last = performance.now();
    let sinceFrame = 0;
    const interval = 1000 / FPS;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = now - last;
      last = now;
      spin += (dt / 1000) * speedRef.current;
      sinceFrame += dt;
      if (sinceFrame < interval) return;
      sinceFrame = 0;
      node.textContent = renderAsciiSphere({ cols, rows, spin });
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cols, rows, reducedMotion]);

  return (
    <pre
      ref={ref}
      aria-hidden
      className={`ascii-grid text-dim ${className}`}
      // Scales with the viewport so the body keeps its proportions on a
      // phone; the character grid itself stays the same cols x rows.
      style={{ fontSize: "clamp(3px, 0.8vw, 9px)" }}
    />
  );
}
