/**
 * Character-grid data glyphs. Kept as pure functions so the bucketing math
 * is testable independently of React — an off-by-one in the level mapping
 * is invisible by eye but makes a chart quietly wrong.
 */

/** Eighth-block ramp, ascending. Index 0 is the shortest visible bar. */
export const SPARK_LEVELS = "▁▂▃▄▅▆▇█";

/**
 * Render values as a one-row block sparkline. `null` entries render as a
 * space — a gap in the data stays a visible gap rather than being
 * interpolated across.
 */
export function renderSparkline(values: Array<number | null>): string {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return " ".repeat(values.length);

  const max = Math.max(...present);
  const min = Math.min(...present);
  const span = max - min;

  return values
    .map((v) => {
      if (v === null) return " ";
      // A flat series has no span to scale against; show it mid-ramp rather
      // than dividing by zero or slamming everything to the floor.
      if (span === 0) return SPARK_LEVELS[Math.floor(SPARK_LEVELS.length / 2)]!;
      const t = (v - min) / span;
      const idx = Math.min(SPARK_LEVELS.length - 1, Math.floor(t * SPARK_LEVELS.length));
      return SPARK_LEVELS[idx]!;
    })
    .join("");
}

/**
 * Render a 0..1 ratio as a fixed-width bar. Uses full blocks for the
 * filled run and a light shade for the remainder, so the track stays
 * visible at zero instead of collapsing to nothing.
 */
export function renderMeter(ratio: number, width: number): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  const filled = Math.round(clamped * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}
