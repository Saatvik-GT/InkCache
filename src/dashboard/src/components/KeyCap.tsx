import type { ReactNode } from "react";

/** A small raised chip styled like a mechanical keyboard cap — used to
    document a keyboard shortcut inline rather than in a separate legend. */
export function KeyCap({ children }: { children: ReactNode }) {
  return (
    <kbd className="neu-raised-sm inline-flex min-w-[1.5em] items-center justify-center rounded-sm px-1.5 py-0.5 text-[10px] font-bold text-ink-mid">
      {children}
    </kbd>
  );
}
