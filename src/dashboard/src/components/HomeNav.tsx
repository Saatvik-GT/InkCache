import { Link } from "react-router-dom";

export function HomeNav() {
  return (
    <header className="neu-raised relative z-10 flex items-center justify-between rounded-lg px-5 py-3">
      <span className="text-sm font-bold tracking-[0.3em] text-ink">INKCACHE</span>
      <nav className="flex items-center gap-4 text-[11px] font-bold tracking-widest text-ink-mid uppercase">
        <a
          href="https://github.com/Saatvik-GT/InkCache"
          target="_blank"
          rel="noreferrer"
          className="hover:text-ink"
        >
          GitHub
        </a>
        <Link
          to="/dashboard"
          className="neu-raised-sm neu-pressable cursor-pointer rounded-md px-3 py-1.5 text-accent"
        >
          Open Dashboard
        </Link>
      </nav>
    </header>
  );
}
