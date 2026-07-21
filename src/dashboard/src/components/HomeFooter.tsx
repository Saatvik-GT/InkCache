export function HomeFooter() {
  return (
    <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-4 text-[10px] tracking-widest text-ink-faint uppercase">
      <a
        href="https://github.com/Saatvik-GT/InkCache"
        target="_blank"
        rel="noreferrer"
        className="hover:text-ink-mid"
      >
        GitHub
      </a>
      <span>·</span>
      <a
        href="https://github.com/Saatvik-GT/InkCache/blob/main/docs/api.md"
        target="_blank"
        rel="noreferrer"
        className="hover:text-ink-mid"
      >
        API Docs
      </a>
      <span>·</span>
      <a
        href="https://github.com/Saatvik-GT/InkCache/blob/main/LICENSE"
        target="_blank"
        rel="noreferrer"
        className="hover:text-ink-mid"
      >
        MIT License
      </a>
      <span>·</span>
      <span>CUSoC 2026</span>
    </footer>
  );
}
