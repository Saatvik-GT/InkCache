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
}: {
  title: string;
  /** Optional right-aligned slot spliced into the top rule. */
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`flex min-w-0 flex-col ${className}`}>
      <div className="flex items-center gap-1 text-xs leading-none text-faint select-none">
        <span aria-hidden>┌─</span>
        <span className="shrink-0 tracking-[0.2em] text-dim uppercase">[ {title} ]</span>
        <Dashes />
        {right !== undefined && (
          <span className="shrink-0 truncate text-dim normal-case">{right}</span>
        )}
        <span aria-hidden>─┐</span>
      </div>

      <div
        className={`min-w-0 flex-1 border-x border-ghost bg-surface px-3 py-3 text-sm ${bodyClassName}`}
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
