import { Link } from "react-router-dom";
import { Dashes } from "./AsciiPanel";

export function HomeNav() {
  return (
    <header className="relative z-10">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
        <span className="text-xs font-bold tracking-[0.35em] text-bright">INKCACHE</span>
        <nav className="flex flex-wrap items-center gap-5 text-[11px] tracking-widest text-dim uppercase">
          <a
            href="https://github.com/Saatvik-GT/InkCache"
            target="_blank"
            rel="noreferrer"
            className="hover:text-bright"
          >
            [ github ]
          </a>
          <Link to="/dashboard" className="text-accent hover:text-bright">
            [ open console ]
          </Link>
        </nav>
      </div>
      <div aria-hidden className="flex text-xs leading-none text-ghost select-none">
        <Dashes />
      </div>
    </header>
  );
}
