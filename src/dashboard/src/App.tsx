import { BootSequence } from "./components/BootSequence";
import { CRTScreen } from "./components/CRTScreen";
import { KeysPanel } from "./components/KeysPanel";
import { KVConsole } from "./components/KVConsole";
import { LogStream } from "./components/LogStream";
import { MetricsPanel } from "./components/MetricsPanel";
import { Panel } from "./components/Panel";
import { useNode, type NodeStatus } from "./hooks/useNode";
import { flush } from "./lib/api";
import { logEvent } from "./lib/log";
import { useSimulator } from "./lib/simulator";
import { useCallback, useEffect, useState } from "react";

const STATUS_BADGE: Record<NodeStatus, { glyph: string; label: string; className: string }> = {
  connecting: { glyph: "◌", label: "CONNECTING", className: "text-phos-mid" },
  online: { glyph: "●", label: "ONLINE", className: "text-phos-bright glow" },
  offline: { glyph: "○", label: "OFFLINE", className: "text-sig-red glow-red" },
};

function App() {
  const { metrics, status, refreshNow } = useNode(1000);
  const { running: simRunning, toggle: toggleSim } = useSimulator();
  const [booting, setBooting] = useState(true);
  const finishBoot = useCallback(() => setBooting(false), []);
  const badge = STATUS_BADGE[status];

  // 's' toggles the traffic simulator unless the user is typing somewhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "s" && (e.target as HTMLElement)?.tagName !== "INPUT") {
        toggleSim();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSim]);

  return (
    <CRTScreen>
      {booting && <BootSequence onDone={finishBoot} />}
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-5 p-4 sm:p-6">
        <header className="flex items-baseline justify-between border-b border-phos-dim pb-2">
          <h1 className="glow text-lg font-bold tracking-[0.3em] text-phos-bright">
            INKCACHE<span className="cursor-blink">█</span>
          </h1>
          <div className="flex items-baseline gap-4 text-xs">
            <span className="hidden text-phos-mid sm:inline">single-node monitor // v0.1</span>
            <button
              type="button"
              onClick={toggleSim}
              title="press s to toggle synthetic traffic"
              className={`cursor-pointer border px-2 py-0.5 tracking-widest ${
                simRunning
                  ? "border-sig-amber-dim text-sig-amber glow-amber"
                  : "border-phos-dim text-phos-mid hover:text-phos"
              }`}
            >
              SIM {simRunning ? "ON " : "OFF"}
            </button>
            <button
              type="button"
              onClick={() => {
                flush()
                  .then((res) => {
                    logEvent("del", `flushed store — dropped ${res.dropped} key${res.dropped === 1 ? "" : "s"}`);
                    refreshNow();
                  })
                  .catch(() => logEvent("err", "flush failed"));
              }}
              title="clear every key from the store"
              className="cursor-pointer border border-sig-red-dim px-2 py-0.5 tracking-widest text-sig-red hover:glow-red"
            >
              FLUSH
            </button>
            <span className={badge.className}>
              {badge.glyph} {badge.label}
            </span>
          </div>
        </header>

        {status === "offline" && (
          <div className="border border-sig-red-dim bg-sig-red/5 px-3 py-2 text-xs text-sig-red glow-red">
            !! LINK DOWN — cache node not responding on :8080. start it with{" "}
            <span className="text-sig-amber">npm run dev:node</span>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <KVConsole onOp={refreshNow} />
          {metrics ? (
            <MetricsPanel metrics={metrics} stale={status === "offline"} />
          ) : (
            <Panel title="METRICS" right="no signal">
              <p className="py-8 text-center text-phos-mid">
                {status === "connecting" ? (
                  <>
                    -- acquiring signal<span className="cursor-blink">_</span> --
                  </>
                ) : (
                  "-- node unreachable --"
                )}
              </p>
            </Panel>
          )}
        </div>

        <KeysPanel refreshToken={metrics ? metrics.sets + metrics.deletes + metrics.evictions : 0} />

        <LogStream />
      </div>
    </CRTScreen>
  );
}

export default App;
