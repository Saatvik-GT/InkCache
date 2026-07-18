import type { ReactNode } from "react";

/** A single sunken corner rivet — the hardware-panel cue that reads the
    card as a screwed-down plate rather than a floating card. */
function Rivet({ className }: { className: string }) {
  return (
    <span aria-hidden className={`neu-inset-sm absolute h-1.25 w-1.25 rounded-full ${className}`} />
  );
}

/**
 * Neumorphic card: a raised slab carved from the base clay color, with the
 * title sitting in a sunken pill so it reads as inset into the panel rather
 * than printed on it, and four corner rivets for a screwed-down-plate feel.
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
    <section className={`neu-raised relative rounded-lg p-5 ${className}`}>
      <Rivet className="top-2 left-2" />
      <Rivet className="top-2 right-2" />
      <Rivet className="bottom-2 left-2" />
      <Rivet className="bottom-2 right-2" />

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
