import type { ReactNode } from "react";

/**
 * Neumorphic card: a raised slab carved from the base clay color, with the
 * title sitting in a sunken pill so it reads as inset into the panel rather
 * than printed on it.
 */
export function Panel({
  title,
  right,
  children,
  className = "",
}: {
  title: string;
  /** Optional right-aligned slot in the header (status text, actions). */
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`neu-raised rounded-3xl p-5 ${className}`}>
      <header className="mb-4 flex items-center justify-between gap-3">
        <span className="neu-inset-sm shrink-0 rounded-full px-3 py-1 text-[10px] font-bold tracking-[0.2em] text-ink-mid uppercase">
          {title}
        </span>
        {right !== undefined && <span className="truncate text-xs text-ink-mid">{right}</span>}
      </header>
      <div className="text-sm text-ink">{children}</div>
    </section>
  );
}
