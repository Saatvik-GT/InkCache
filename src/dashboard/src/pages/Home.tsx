import { Link } from "react-router-dom";
import { AsciiHeadline } from "../components/AsciiHeadline";
import { AsciiMoon } from "../components/AsciiMoon";
import { HomeFooter } from "../components/HomeFooter";
import { HomeNav } from "../components/HomeNav";
import { LiveStatsStrip } from "../components/LiveStatsStrip";
import { StarField } from "../components/StarField";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useNode } from "../hooks/useNode";

// The moon's spin speed floor, load cap, and rad/s-per-op — floored well
// above zero so an idle node still visibly turns instead of looking like a
// still, and capped so heavy traffic reads as "busy" rather than a glitch.
const SPIN_BASE = 0.45;
const SPIN_MAX_OPS = 25;
const SPIN_PER_OP = 0.03;

export function Home() {
  const { metrics, status } = useNode(1000);
  useDocumentTitle("InkCache — access-pattern-aware caching");

  const spinSpeed = SPIN_BASE + Math.min(metrics?.opsPerSec ?? 0, SPIN_MAX_OPS) * SPIN_PER_OP;

  return (
    <div className="ascii-scanlines relative min-h-screen overflow-hidden bg-void">
      <StarField />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-4 sm:px-6">
        <HomeNav />

        <section className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1fr_1fr] lg:gap-6">
          <div className="min-w-0">
            <p className="mb-7 text-[10px] tracking-[0.3em] text-dim uppercase">
              <span className="text-accent">//</span> inkcache — single-node cache
            </p>

            {/* Three stacked words at descending weight: the first is the
                claim, the last is the one doing the work. */}
            <div className="space-y-2">
              <AsciiHeadline lines={["CACHE"]} className="text-bright" />
              <AsciiHeadline lines={["THAT"]} className="opacity-70" />
              <AsciiHeadline lines={["ADAPTS"]} className="text-accent" />
            </div>

            <p className="mt-9 max-w-sm text-xs leading-relaxed text-text">
              Most caches evict by recency alone and drop a hot key the moment something newer
              arrives. InkCache evicts whichever least-recently-used key has actually been read the
              fewest times — so a key that earns its space keeps it.
            </p>

            <div className="mt-9">
              <LiveStatsStrip metrics={metrics} status={status} />
            </div>

            <Link
              to="/dashboard"
              className="group mt-9 inline-flex items-center gap-2 border border-ghost px-5 py-2.5 text-[11px] tracking-widest text-accent uppercase hover:border-accent hover:text-bright"
            >
              <span>open live console</span>
              <span aria-hidden className="transition-transform group-hover:translate-x-1">
                →
              </span>
            </Link>
          </div>

          <div className="flex min-w-0 justify-center lg:justify-end">
            <AsciiMoon spinSpeed={spinSpeed} />
          </div>
        </section>

        <HomeFooter />
      </div>
    </div>
  );
}
