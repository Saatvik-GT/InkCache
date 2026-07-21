import { Link } from "react-router-dom";

/**
 * Landing page — placeholder scaffold. Real content (3D hero, live stats,
 * feature cards, quickstart, architecture note) lands in the commits that
 * follow this one, each independently.
 */
export function Home() {
  return (
    <div className="neu-field flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold tracking-[0.3em] text-ink">INKCACHE</h1>
      <p className="max-w-md text-sm text-ink-mid">
        Intelligent, access-pattern-aware caching — local demo home page under construction.
      </p>
      <Link
        to="/dashboard"
        className="neu-raised neu-pressable cursor-pointer rounded-md px-4 py-2 text-[11px] font-bold tracking-widest text-accent uppercase"
      >
        Open Dashboard
      </Link>
    </div>
  );
}
