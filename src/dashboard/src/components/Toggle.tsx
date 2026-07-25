/**
 * Terminal switch: [ON ]/[OFF] rendered as characters rather than a
 * sliding knob. Still a real switch to assistive tech — role and
 * aria-checked carry the state that the glyphs show visually.
 */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      title={label}
      className={`cursor-pointer border border-ghost px-2 py-1 text-[10px] tracking-widest uppercase ${
        checked ? "border-accent text-accent" : "text-faint hover:text-dim"
      }`}
    >
      {checked ? "[■ on ]" : "[□ off]"}
    </button>
  );
}
