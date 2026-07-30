import type { ReactNode } from "react";

/**
 * A run of box-drawing rule that fills whatever space it's given. Overflow
 * is clipped rather than wrapped, so a long run can't push the closing
 * corner onto a second line.
 */
export function Dashes({ char = "─", className = "" }: { char?: string; className?: string }) {
  return (
    <span aria-hidden className={`min-w-0 flex-1 overflow-hidden whitespace-nowrap ${className}`}>
      {char.repeat(400)}
    </span>
  );
}

/**
 * Panel chrome drawn with actual box-drawing characters: the top and bottom
 * rules are flex rows of real glyphs, so the frame adapts to any width
 * while staying on the character grid. The vertical sides are hairline
 * borders rather than a column of │ glyphs — a stack of characters can't
 * track a fluid-height container without either clipping or overflowing.
 */
export function AsciiPanel({
  title,
  right,
  children,
  className = "",
  bodyClassName = "",
  accent = false,
}: {
  title: string;
  /** Optional right-aligned slot spliced into the top rule. */
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Lifts the title out of the greyscale — for the panel you look at first. */
  accent?: boolean;
}) {
  return (
    // aria-label rather than relying on the visible title text: a <section>
    // is an implicit landmark region, and without a name every panel on the
    // page would show up identically as "region" in landmark navigation.
    <section aria-label={title} className={`flex min-w-0 flex-col ${className}`}>
      <div className="flex items-center gap-1 text-xs leading-none text-faint select-none">
        <span aria-hidden>┌─</span>
        <span
          className={`shrink-0 tracking-[0.2em] uppercase ${accent ? "text-accent" : "text-dim"}`}
        >
          [ {title} ]
        </span>
        <Dashes />
        {right !== undefined && (
          <span className="shrink-0 truncate text-dim normal-case">{right}</span>
        )}
        <span aria-hidden>─┐</span>
      </div>

      {/* min-h-0 is load-bearing: without it a flex child that scrolls
          refuses to shrink below its content and blows past the panel. */}
      <div
        className={`min-h-0 min-w-0 flex-1 border-x border-ghost bg-surface p-3 text-sm ${bodyClassName}`}
      >
        {children}
      </div>

      <div className="flex items-center gap-1 text-xs leading-none text-faint select-none">
        <span aria-hidden>└─</span>
        <Dashes />
        <span aria-hidden>─┘</span>
      </div>
    </section>
  );
}
