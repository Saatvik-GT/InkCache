import { Link } from "react-router-dom";
import { ArchitectureNote } from "../components/ArchitectureNote";
import { FeatureCards } from "../components/FeatureCards";
import { HeroScene } from "../components/HeroScene";
import { HomeFooter } from "../components/HomeFooter";
import { HomeNav } from "../components/HomeNav";
import { LiveStatsStrip } from "../components/LiveStatsStrip";
import { QuickStart } from "../components/QuickStart";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useNode } from "../hooks/useNode";

export function Home() {
  const { metrics, status } = useNode(1000);
  useDocumentTitle("InkCache — intelligent access-pattern-aware caching");

  return (
    <div className="neu-field min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-4 sm:p-6">
        <HomeNav />

        <section className="flex flex-col items-center gap-4 pt-6 text-center">
          <div className="h-64 w-full max-w-sm">
            <HeroScene hitRate={metrics?.hitRate ?? null} opsPerSec={metrics?.opsPerSec ?? 0} />
          </div>

          <h1 className="text-2xl font-bold tracking-[0.3em] text-ink">INKCACHE</h1>
          <p className="max-w-md text-sm text-ink-mid">
            Intelligent, access-pattern-aware caching — a real single-node demo, not a mockup. The
            ring above spins with real ops/s and glows with real hit rate.
          </p>

          <Link
            to="/dashboard"
            className="neu-raised neu-pressable cursor-pointer rounded-md px-5 py-2.5 text-[11px] font-bold tracking-widest text-accent uppercase"
          >
            Open Dashboard
          </Link>

          <LiveStatsStrip metrics={metrics} status={status} />
        </section>

        <FeatureCards />

        <div className="grid gap-4 sm:grid-cols-2">
          <QuickStart />
          <ArchitectureNote />
        </div>

        <HomeFooter />
      </div>
    </div>
  );
}
