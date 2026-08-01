/**
 * Character-grid data glyphs. Kept as pure functions so the bucketing math
 * is testable independently of React — an off-by-one in the level mapping
 * is invisible by eye but makes a chart quietly wrong.
 */

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
