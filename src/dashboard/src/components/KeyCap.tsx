import type { ReactNode } from "react";

/** A key rendered the way a man page writes one: angle-bracketed. */
export function KeyCap({ children }: { children: ReactNode }) {
  return <kbd className="border border-ghost px-1 text-[10px] text-dim">&lt;{children}&gt;</kbd>;
}
