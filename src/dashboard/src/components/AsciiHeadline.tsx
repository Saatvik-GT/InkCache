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
  glyph = "#",
  size = "clamp(3px, 0.95vw, 9px)",
}: {
  lines: string[];
  className?: string;
  /** Character painted for a lit pixel. */
  glyph?: string;
  /** font-size for the character grid; the bitmap itself is fixed at 5x7. */
  size?: string;
}) {
  const rendered = useMemo(
    () => lines.map((line) => renderAsciiText(line, { on: glyph })),
    [lines, glyph],
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
