import { BootSequence } from "./components/BootSequence";
import { Button } from "./components/Button";
import { KeysPanel } from "./components/KeysPanel";
import { KVConsole } from "./components/KVConsole";
import { LogStream } from "./components/LogStream";
import { MetricsPanel } from "./components/MetricsPanel";
import { Panel } from "./components/Panel";
import { TicketDivider } from "./components/TicketDivider";
import { Toggle } from "./components/Toggle";
import { useNode, type NodeStatus } from "./hooks/useNode";
import { flush } from "./lib/api";
import { logEvent } from "./lib/log";
import { useSimulator } from "./lib/simulator";
import { useCallback, useEffect, useState } from "react";

const STATUS_DOT: Record<NodeStatus, string> = {
  connecting: "bg-ink-mid",
  online: "bg-accent",
  offline: "bg-kind-err",
};

const STATUS_LABEL: Record<NodeStatus, string> = {
  connecting: "CONNECTING",
  online: "ONLINE",
  offline: "OFFLINE",
};

function App() {
  const { metrics, status, history, refreshNow } = useNode(1000);
  const { running: simRunning, toggle: toggleSim } = useSimulator();
  const [booting, setBooting] = useState(true);
  const finishBoot = useCallback(() => setBooting(false), []);

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
    <div className="neu-field min-h-screen">
      {booting && <BootSequence onDone={finishBoot} />}
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-4 p-4 sm:p-6">
        <header className="neu-raised flex flex-wrap items-center justify-between gap-4 rounded-lg px-5 py-3">
          <h1 className="text-base font-bold tracking-[0.3em] text-ink">INKCACHE</h1>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-[11px] tracking-widest text-ink-mid uppercase">
              sim
              <Toggle
                checked={simRunning}
                onChange={toggleSim}
                label="toggle synthetic traffic (s)"
              />
            </label>

            <Button
              tone="danger"
              title="clear every key from the store"
              onClick={() => {
                flush()
                  .then((res) => {
                    logEvent(
                      "del",
                      `flushed store — dropped ${res.dropped} key${res.dropped === 1 ? "" : "s"}`,
                    );
                    refreshNow();
                  })
                  .catch(() => logEvent("err", "flush failed"));
              }}
            >
              flush
            </Button>

            <span className="neu-inset-sm flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold tracking-widest text-ink-mid uppercase">
              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
              {STATUS_LABEL[status]}
            </span>
          </div>
        </header>

        <TicketDivider />

        {status === "offline" && (
          <div className="neu-inset rounded-md border-l-2 border-kind-err px-4 py-3 text-xs text-kind-err">
            !! LINK DOWN — cache node not responding on :8080. start it with{" "}
            <span className="text-ink">npm run dev:node</span>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <KVConsole onOp={refreshNow} />
          {metrics ? (
            <MetricsPanel metrics={metrics} history={history} stale={status === "offline"} />
          ) : (
            <Panel title="METRICS" right="no signal">
              <p className="py-8 text-center text-ink-mid">
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

        <KeysPanel
          refreshToken={metrics ? metrics.sets + metrics.deletes + metrics.evictions : 0}
        />

        <LogStream />
      </div>
    </div>
  );
}

export default App;
