/**
 * Line plotting on a character grid, with connected segments rather than
 * loose points — a scatter of dots reads as noise at this resolution,
 * where a continuous trace reads as a signal.
 *
 * Deliberately one dot per cell using characters known to be in the
 * bundled font. Braille (U+28xx) would give 2x4 sub-cell resolution and is
 * what most terminal charting libraries reach for, but JetBrains Mono
 * doesn't cover that block — the browser would fall back to another face
 * at a different advance width and shear the whole character grid.
 */

export const PLOT_DOT = "·";

export interface PlotOptions {
  cols: number;
  rows: number;
  /** Axis floor/ceiling. Omit to fit the data. */
  min?: number;
  max?: number;
  dot?: string;
}

export interface PlotResult {
  /** `rows` lines of exactly `cols` characters. */
  text: string;
  min: number;
  max: number;
}

/** Nice-ish axis bounds: pad the range a little so the trace isn't glued
    to the frame, and never return a zero-height range. */
function bounds(values: number[], min?: number, max?: number): { lo: number; hi: number } {
  const lo = min ?? Math.min(...values);
  let hi = max ?? Math.max(...values);
  if (hi <= lo) hi = lo + 1; // flat series still needs a drawable range
  return { lo, hi };
}

/**
 * Rasterize one series. Returns spaces (not a blank glyph) wherever the
 * trace isn't, so several of these can be stacked as transparent layers to
 * get per-series colour — a single merged grid could only ever be one colour.
 */
export function plotSeries(
  values: Array<number | null>,
  { cols, rows, min, max, dot = PLOT_DOT }: PlotOptions,
): PlotResult {
  const present = values.filter((v): v is number => v !== null);
  const { lo, hi } = bounds(present.length ? present : [0], min, max);

  const grid = new Array<string>(cols * rows).fill(" ");
  const set = (x: number, y: number) => {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return;
    grid[y * cols + x] = dot;
  };

  const n = values.length;
  const points = values.map((v, i) => {
    if (v === null) return null;
    const t = (v - lo) / (hi - lo);
    return {
      x: n <= 1 ? 0 : Math.round((i / (n - 1)) * (cols - 1)),
      // Row 0 is the top of the plot, so invert.
      y: Math.round((1 - Math.min(1, Math.max(0, t))) * (rows - 1)),
    };
  });

  let prev: { x: number; y: number } | null = null;
  for (const p of points) {
    if (!p) {
      // A gap in the data breaks the trace instead of being bridged —
      // drawing straight through a hole would invent readings.
      prev = null;
      continue;
    }
    if (prev) {
      const dx = p.x - prev.x;
      if (dx === 0) {
        const [a, b] = prev.y <= p.y ? [prev.y, p.y] : [p.y, prev.y];
        for (let y = a; y <= b; y++) set(p.x, y);
      } else {
        let lastY = prev.y;
        for (let x = prev.x; x <= p.x; x++) {
          const y = Math.round(prev.y + ((p.y - prev.y) * (x - prev.x)) / dx);
          // Fill the vertical run too: on a steep segment, plotting only
          // one cell per column leaves the trace visibly dotted apart.
          const [a, b] = lastY <= y ? [lastY, y] : [y, lastY];
          for (let yy = a; yy <= b; yy++) set(x, yy);
          lastY = y;
        }
      }
    } else {
      set(p.x, p.y);
    }
    prev = p;
  }

  const lines: string[] = [];
  for (let r = 0; r < rows; r++) lines.push(grid.slice(r * cols, r * cols + cols).join(""));
  return { text: lines.join("\n"), min: lo, max: hi };
}

/**
 * Evenly spaced axis tick values from low to high, for labelling a plot
 * rendered at the same bounds.
 */
export function axisTicks(min: number, max: number, count: number): number[] {
  if (count <= 1) return [max];
  return Array.from(
    { length: count },
    (_, i) => min + ((max - min) * (count - 1 - i)) / (count - 1),
  );
}

/**
 * Vertical bar chart. Bars are `barWidth` cells wide separated by a single
 * space; heights are floored to at least one cell for any non-zero value so
 * a small-but-present bar never renders as nothing.
 */
export function renderBarChart(
  values: number[],
  { rows, barWidth = 3, block = "█" }: { rows: number; barWidth?: number; block?: string },
): string {
  const max = Math.max(1, ...values);
  const heights = values.map((v) => (v <= 0 ? 0 : Math.max(1, Math.round((v / max) * rows))));

  const lines: string[] = [];
  for (let r = rows; r > 0; r--) {
    lines.push(
      heights.map((h) => (h >= r ? block.repeat(barWidth) : " ".repeat(barWidth))).join(" "),
    );
  }
  return lines.join("\n");
}
