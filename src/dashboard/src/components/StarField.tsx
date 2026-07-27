import { useEffect, useMemo, useRef } from "react";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

/** Dimmest to brightest. Most stars should sit at the faint end. */
const STAR_GLYPHS = [".", ".", ".", "·", "·", "+", "*"];

// A slow shimmer, not a framerate — negligible work next to the moon's
// 24fps loop, so there's no need to chase a smooth animation here.
const PAINT_INTERVAL_MS = 250;

/**
 * Deterministic hash — a fixed sky beats a re-randomized one, which would
 * reshuffle on every re-render and read as noise rather than as a
 * background.
 */
function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

interface Star {
  col: number;
  row: number;
  glyph: string;
  /** Phase offset so stars don't all pulse in lockstep. */
  phase: number;
  /** Only a minority twinkle; a fully animated sky is distracting. */
  twinkles: boolean;
}

function buildStars(cols: number, rows: number, count: number): Star[] {
  const stars: Star[] = [];
  const taken = new Set<number>();
  for (let i = 0; i < count; i++) {
    const col = Math.floor(hash(i * 3 + 1) * cols);
    const row = Math.floor(hash(i * 3 + 2) * rows);
    const key = row * cols + col;
    if (taken.has(key)) continue; // two stars in one cell just overwrite
    taken.add(key);
    const b = hash(i * 3 + 3);
    stars.push({
      col,
      row,
      glyph: STAR_GLYPHS[Math.floor(b * STAR_GLYPHS.length)]!,
      phase: hash(i * 7 + 5) * Math.PI * 2,
      twinkles: b > 0.72,
    });
  }
  return stars;
}

/**
 * Fixed-position ASCII starfield behind the page. Rendered to a single
 * <pre> and written via ref, same as the moon — a few hundred stars as
 * individual DOM nodes would be a lot of layout for pure atmosphere.
 */
export function StarField({
  cols = 200,
  rows = 60,
  count = 220,
}: {
  cols?: number;
  rows?: number;
  count?: number;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const stars = useMemo(() => buildStars(cols, rows, count), [cols, rows, count]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const paint = (t: number) => {
      const grid = new Array<string>(cols * rows).fill(" ");
      for (const s of stars) {
        // A twinkling star drops out entirely on the low half of its cycle,
        // which reads as a flicker; steady stars are always drawn.
        const lit = !s.twinkles || Math.sin(t + s.phase) > -0.35;
        if (lit) grid[s.row * cols + s.col] = s.glyph;
      }
      const lines: string[] = [];
      for (let r = 0; r < rows; r++) lines.push(grid.slice(r * cols, r * cols + cols).join(""));
      node.textContent = lines.join("\n");
    };

    if (reducedMotion) {
      paint(0);
      return;
    }

    paint(0);
    const start = performance.now();
    const id = setInterval(() => paint((performance.now() - start) / 900), PAINT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [stars, cols, rows, reducedMotion]);

  return (
    <pre
      ref={ref}
      aria-hidden
      className="ascii-grid pointer-events-none fixed inset-0 overflow-hidden text-ghost"
      style={{ fontSize: "clamp(6px, 0.75vw, 11px)" }}
    />
  );
}
