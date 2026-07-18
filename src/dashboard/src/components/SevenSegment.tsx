/**
 * Retro LCD-style digit readout, built from real SVG segments (not a font
 * or an icon set) — each digit lights the a-g segments a physical 7-segment
 * display would. Used for the uptime clock; ':' renders as two dots.
 */
const SEGMENTS: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
  "6": "afgecd",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
};

// x, y, w, h for each segment on a 10x18 grid
const SEG_RECT: Record<string, [number, number, number, number]> = {
  a: [1, 0, 8, 2],
  g: [1, 8, 8, 2],
  d: [1, 16, 8, 2],
  f: [0, 1, 2, 8],
  b: [8, 1, 2, 8],
  e: [0, 9, 2, 8],
  c: [8, 9, 2, 8],
};

function Digit({ char }: { char: string }) {
  if (char === ":") {
    return (
      <svg width={5} height={18} viewBox="0 0 5 18" aria-hidden className="shrink-0">
        <rect x={1.5} y={4} width={2} height={2} rx={0.5} fill="var(--color-accent)" />
        <rect x={1.5} y={12} width={2} height={2} rx={0.5} fill="var(--color-accent)" />
      </svg>
    );
  }
  const on = new Set((SEGMENTS[char] ?? "").split(""));
  return (
    <svg width={10} height={18} viewBox="0 0 10 18" aria-hidden className="shrink-0">
      {Object.entries(SEG_RECT).map(([id, [x, y, w, h]]) => (
        <rect
          key={id}
          x={x}
          y={y}
          width={w}
          height={h}
          rx={0.6}
          fill={on.has(id) ? "var(--color-accent)" : "var(--color-shadow-dark)"}
          opacity={on.has(id) ? 1 : 0.3}
        />
      ))}
    </svg>
  );
}

export function SevenSegment({ value }: { value: string }) {
  return (
    <div
      className="neu-inset-sm inline-flex items-end gap-[3px] rounded-md px-2 py-1.5"
      aria-label={value}
    >
      {value.split("").map((c, i) => (
        <Digit key={i} char={c} />
      ))}
    </div>
  );
}
