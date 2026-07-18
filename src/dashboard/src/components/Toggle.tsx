/**
 * Neumorphic switch: a sunken track with a raised knob that slides and
 * lights up with the accent color when on. Standard switch semantics
 * (role="switch", aria-checked) so it's announced correctly, not just
 * styled like one.
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
      className="neu-inset-sm relative h-7 w-14 shrink-0 cursor-pointer rounded-full"
    >
      <span
        className={`neu-raised-sm absolute top-0.5 left-0.5 h-6 w-6 rounded-full transition-transform duration-150 ${
          checked ? "neu-accent-fill translate-x-7" : "translate-x-0"
        }`}
      />
    </button>
  );
}
