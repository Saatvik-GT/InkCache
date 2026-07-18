import type { ReactNode } from "react";

/**
 * A pressable neumorphic button: raised at rest, sinks into the panel on
 * press (see .neu-pressable). `tone` swaps the label color only — the shape
 * language stays identical so tone reads as "what this does", not
 * "how important this looks" (avoids a rainbow of button styles).
 */
const TONE_CLASS: Record<"default" | "accent" | "danger", string> = {
  default: "text-ink-mid hover:text-ink",
  accent: "text-accent",
  danger: "text-kind-err",
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
      className={`neu-raised neu-pressable cursor-pointer rounded-2xl px-4 py-2 text-[11px] font-bold tracking-widest uppercase ${TONE_CLASS[tone]}`}
    >
      {children}
    </button>
  );
}
