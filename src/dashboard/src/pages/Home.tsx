import { Link } from "react-router-dom";
import { ArchitectureNote } from "../components/ArchitectureNote";
import { AsciiHeadline } from "../components/AsciiHeadline";
import { AsciiMoon } from "../components/AsciiMoon";
import { FeatureCards } from "../components/FeatureCards";
import { HomeFooter } from "../components/HomeFooter";
import { HomeNav } from "../components/HomeNav";
import { LiveStatsStrip } from "../components/LiveStatsStrip";
import { QuickStart } from "../components/QuickStart";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useNode } from "../hooks/useNode";

export function Home() {
  const { metrics, status } = useNode(1000);
  useDocumentTitle("InkCache — access-pattern-aware caching");

  // The body turns faster under load. Capped so heavy traffic reads as
  // "busy" rather than as a rendering glitch, and floored so an idle node
  // still drifts instead of looking frozen.
  const spinSpeed = 0.12 + Math.min(metrics?.opsPerSec ?? 0, 25) * 0.02;

  return (
    <div className="ascii-scanlines relative min-h-screen bg-void">
      <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6">
        <HomeNav />

        {/* Hero: type on the left, the body on the right — the moon is the
            only thing on the page allowed to be purely atmospheric, and even
            it is driven by live throughput. */}
        <section className="grid items-center gap-8 py-10 lg:grid-cols-[1fr_1fr] lg:gap-4 lg:py-16">
          <div className="min-w-0">
            <p className="mb-6 text-[10px] tracking-[0.25em] text-dim uppercase">
              // inkcache — single-node cache with access-aware eviction
            </p>

            <AsciiHeadline lines={["CACHE", "THAT", "ADAPTS"]} />

            <p className="mt-8 max-w-sm text-xs leading-relaxed text-text">
              Most caches evict by recency alone and drop a hot key the moment something newer
              arrives. InkCache samples the least-recently-used keys and evicts whichever of those
              has actually been read the fewest times — so a key that earns its space keeps it.
            </p>

            <div className="mt-8">
              <LiveStatsStrip metrics={metrics} status={status} />
            </div>

            <Link
              to="/dashboard"
              className="mt-8 inline-block border border-ghost px-4 py-2 text-[11px] tracking-widest text-accent uppercase hover:border-accent hover:text-bright"
            >
              [ open live console ]
            </Link>
          </div>

          <div className="flex min-w-0 justify-center lg:justify-end">
            <AsciiMoon spinSpeed={spinSpeed} />
          </div>
        </section>

        <section className="py-8">
          <FeatureCards />
        </section>

        <section className="grid gap-4 pb-8 lg:grid-cols-2">
          <QuickStart />
          <ArchitectureNote />
        </section>

        <HomeFooter />
      </div>
    </div>
  );
}
