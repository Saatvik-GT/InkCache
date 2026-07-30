import { AsciiPanel, Dashes } from "../components/AsciiPanel";
import { BootSequence } from "../components/BootSequence";
import { Button } from "../components/Button";
import { KeysPanel } from "../components/KeysPanel";
import { KVConsole } from "../components/KVConsole";
import { LogStream } from "../components/LogStream";
import { StatsTable } from "../components/StatsTable";
import { StoreGauge } from "../components/StoreGauge";
import { TopKeysChart } from "../components/TopKeysChart";
import { LatencyChart, TrafficChart } from "../components/TrafficChart";
import { Toggle } from "../components/Toggle";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useNode, type NodeStatus } from "../hooks/useNode";
import { describeFetchError, flush } from "../lib/api";
import { logEvent } from "../lib/log";
import { useSimulator } from "../lib/simulator";
import { setSoundEnabled, useSoundEnabled } from "../lib/sound";
import { StarField } from "../components/StarField";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

/** Shared fixed height for the three bottom stream panels — see the grid
    comment below for why a fixed (not minimum) height matters here. */
const STREAM_PANEL_HEIGHT = "h-104";

/** Status as a glyph as well as a colour, so it survives monochrome. */
const STATUS: Record<NodeStatus, { glyph: string; label: string; tone: string }> = {
  connecting: { glyph: "◌", label: "connecting", tone: "text-dim" },
  online: { glyph: "●", label: "online", tone: "text-accent" },
  offline: { glyph: "○", label: "offline", tone: "text-kind-err" },
};

export function Dashboard() {
  const { metrics, status, history, refreshNow } = useNode(1000);
  const { running: simRunning, toggle: toggleSim } = useSimulator();
  const soundEnabled = useSoundEnabled();
  const [booting, setBooting] = useState(true);
  const finishBoot = useCallback(() => setBooting(false), []);
  // Guards against a rapid double-click firing two independent flush
  // requests -- each would log its own "flushed store" line even though
  // the second one always drops zero keys, since the first already emptied
  // the store.
  const [flushing, setFlushing] = useState(false);
  useDocumentTitle("InkCache — node console");

  // 's' toggles the traffic simulator, 'm' toggles sound, unless typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "s") toggleSim();
      if (e.key === "m") setSoundEnabled(!soundEnabled);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSim, soundEnabled]);

  const badge = STATUS[status];
  // Any write-ish op invalidates the key views; recomputing off the
  // counters means they refetch on real change rather than on a timer.
  const keyRefreshToken = metrics ? metrics.sets + metrics.deletes + metrics.evictions : 0;

  return (
    <div className="ascii-scanlines relative min-h-screen overflow-hidden bg-void">
      <StarField count={140} />
      {booting && <BootSequence onDone={finishBoot} />}

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col gap-4 p-4 sm:px-6">
        <h1 className="sr-only">InkCache node console</h1>
        <header>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-2">
            <Link
              to="/"
              className="group flex items-baseline gap-2 text-xs tracking-[0.35em] text-bright hover:text-accent"
              title="home"
            >
              <span
                aria-hidden
                className="text-accent transition-transform group-hover:-translate-x-1"
              >
                ←
              </span>
              <span className="font-bold">INKCACHE</span>
              <span className="tracking-normal text-faint normal-case">/ console</span>
            </Link>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-[10px] tracking-widest text-faint uppercase">
                sim
                <Toggle
                  checked={simRunning}
                  onChange={toggleSim}
                  label="toggle synthetic traffic (s)"
                />
              </label>

              <label className="flex items-center gap-2 text-[10px] tracking-widest text-faint uppercase">
                snd
                <Toggle
                  checked={soundEnabled}
                  onChange={() => setSoundEnabled(!soundEnabled)}
                  label="toggle op-stream sound cues (m)"
                />
              </label>

              <Button
                tone="danger"
                title="clear every key from the store"
                disabled={flushing}
                onClick={() => {
                  setFlushing(true);
                  flush()
                    .then((res) => {
                      logEvent(
                        "del",
                        `flushed store — dropped ${res.dropped} key${res.dropped === 1 ? "" : "s"}`,
                      );
                      refreshNow();
                    })
                    .catch((err: unknown) => logEvent("err", describeFetchError(err)))
                    .finally(() => setFlushing(false));
                }}
              >
                flush
              </Button>

              <span
                aria-live="polite"
                className={`flex items-center gap-2 border border-ghost px-2 py-1 text-[10px] tracking-widest uppercase ${badge.tone}`}
              >
                <span aria-hidden className={status === "online" ? "cursor-blink" : ""}>
                  {badge.glyph}
                </span>
                {badge.label}
              </span>
            </div>
          </div>
          <div aria-hidden className="flex text-xs leading-none text-ghost select-none">
            <Dashes />
          </div>
        </header>

        {status === "offline" && (
          <div className="border border-kind-err/40 px-4 py-3 text-xs text-kind-err">
            !! link down — cache node not responding on :8080. start it with{" "}
            <span className="text-bright">npm run dev:node</span>
          </div>
        )}

        {/* Dense tiled grid: charts on top where they're scanned first,
            interactive surfaces below. 12 columns so panels can take
            asymmetric widths instead of everything being a half. */}
        <div className="grid gap-3 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <TrafficChart history={history} />
          </div>
          <div className="lg:col-span-5">
            <LatencyChart history={history} />
          </div>

          <div className="lg:col-span-4">
            {metrics ? (
              <StatsTable metrics={metrics} stale={status === "offline"} />
            ) : (
              <AsciiPanel title="node counters" right="no signal" className="h-full">
                <p className="py-10 text-center text-xs text-dim">
                  {status === "connecting" ? (
                    <>
                      acquiring signal<span className="cursor-blink">_</span>
                    </>
                  ) : (
                    "node unreachable"
                  )}
                </p>
              </AsciiPanel>
            )}
          </div>
          <div className="lg:col-span-4">
            <TopKeysChart refreshToken={keyRefreshToken} />
          </div>
          <div className="flex flex-col gap-3 lg:col-span-4">
            {metrics ? (
              <StoreGauge metrics={metrics} stale={status === "offline"} />
            ) : (
              <AsciiPanel title="store capacity" right="--" className="h-full">
                <p className="py-6 text-center text-xs text-dim">no signal</p>
              </AsciiPanel>
            )}
          </div>

          {/* Equal thirds, and a *definite* height rather than a minimum:
              these panels hold streams that grow without bound, and with an
              auto-height cell the inner overflow never engages — the panel
              just keeps getting taller as entries arrive. A fixed height is
              what gives flex-1 + min-h-0 something to resolve against.
              STREAM_PANEL_HEIGHT (26rem/416px) is shared across all three
              so a future tweak can't accidentally desync them. */}
          <div className={`${STREAM_PANEL_HEIGHT} lg:col-span-4`}>
            <KVConsole onOp={refreshNow} />
          </div>
          <div className={`${STREAM_PANEL_HEIGHT} lg:col-span-4`}>
            <KeysPanel refreshToken={keyRefreshToken} />
          </div>
          <div className={`${STREAM_PANEL_HEIGHT} lg:col-span-4`}>
            <LogStream />
          </div>
        </div>
      </div>
    </div>
  );
}
