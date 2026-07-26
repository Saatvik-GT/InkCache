import { useMemo } from "react";
import { renderAsciiText } from "../lib/asciiFont";

/**
 * Dot-matrix headline. Each line is rendered independently so long
 * headings can be stacked without the bitmap needing to know about
 * wrapping — the caller decides the line breaks, same as a print layout.
 */
export function AsciiHeadline({
  lines,
  className = "",
  glyph = "█",
  size = "clamp(3px, 0.78vw, 8px)",
  tracking = 1,
}: {
  lines: string[];
  className?: string;
  /** Character painted for a lit pixel. */
  glyph?: string;
  /** font-size for the character grid; the bitmap itself is fixed at 5x7. */
  size?: string;
  /** Blank pixel columns between letters. */
  tracking?: number;
}) {
  const rendered = useMemo(
    // pixelWidth 2 makes each bitmap pixel roughly square; at 1 the
    // letterforms come out squeezed to two-thirds width and mush together.
    () => lines.map((line) => renderAsciiText(line, { on: glyph, tracking, pixelWidth: 2 })),
    [lines, glyph, tracking],
  );

  return (
    // The visually-hidden heading carries the real text: the bitmap is a
    // grid of '#' characters, which is meaningless to a screen reader (and
    // would be read out character by character).
    <div className={className}>
      <h1 className="sr-only">{lines.join(" ")}</h1>
      <div aria-hidden className="ascii-grid text-bright" style={{ fontSize: size }}>
        {rendered.map((block, i) => (
          <div key={i} className={i > 0 ? "mt-[0.6em]" : ""}>
            {block}
          </div>
        ))}
      </div>
    </div>
  );
}
