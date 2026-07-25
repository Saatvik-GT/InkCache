import type { ReactNode } from "react";

/**
 * Bracketed terminal button. Tone changes the label colour only — the
 * shape language stays identical so tone reads as "what this does", not
 * as a second visual hierarchy.
 */
const TONE: Record<"default" | "accent" | "danger", string> = {
  default: "text-dim hover:text-bright hover:border-dim",
  accent: "text-accent hover:text-bright hover:border-accent",
  danger: "text-kind-err hover:text-bright hover:border-kind-err",
};

export function Button({
  children,
  onClick,
  title,
  tone = "default",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  tone?: "default" | "accent" | "danger";
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      title={title}
      className={`cursor-pointer border border-ghost px-2 py-1 text-[10px] tracking-widest uppercase ${TONE[tone]}`}
    >
      [ {children} ]
    </button>
  );
}
