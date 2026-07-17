import type { ReactNode } from "react";

/**
 * Terminal panel: sharp 1px phosphor border with the title spliced into the
 * top edge, box-drawing style — ┌─[ TITLE ]────┐.
 */
export function Panel({
  title,
  right,
  children,
  className = "",
}: {
  title: string;
  /** Optional right-aligned slot in the title bar (status glyphs, hints). */
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`relative border border-phos-dim ${className}`}>
      <header className="absolute -top-[0.7em] left-2 right-2 flex items-center justify-between gap-2 text-xs leading-none">
        <span className="shrink-0 bg-crt px-1 text-phos-bright tracking-widest">[ {title} ]</span>
        {right !== undefined && <span className="truncate bg-crt px-1 text-phos-mid">{right}</span>}
      </header>
      <div className="p-3 pt-4 text-sm">{children}</div>
    </section>
  );
}
