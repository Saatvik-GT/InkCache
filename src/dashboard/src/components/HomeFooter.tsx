import { Dashes } from "./AsciiPanel";

const LINKS = [
  { href: "https://github.com/Saatvik-GT/InkCache", label: "github" },
  { href: "https://github.com/Saatvik-GT/InkCache/blob/main/docs/api.md", label: "api docs" },
  { href: "https://github.com/Saatvik-GT/InkCache/blob/main/LICENSE", label: "mit license" },
];

export function HomeFooter() {
  return (
    <footer className="pt-2">
      <div aria-hidden className="flex text-xs leading-none text-ghost select-none">
        <Dashes />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4 text-[10px] tracking-widest text-faint uppercase">
        <span className="flex flex-wrap gap-4">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="hover:text-dim"
            >
              {l.label}
            </a>
          ))}
        </span>
        <span>CUSoC 2026 · built for the terminal</span>
      </div>
    </footer>
  );
}
