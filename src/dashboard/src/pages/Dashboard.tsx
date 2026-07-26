import { AsciiPanel, Dashes } from "../components/AsciiPanel";
import { BootSequence } from "../components/BootSequence";
import { Button } from "../components/Button";
import { KeysPanel } from "../components/KeysPanel";
import { KVConsole } from "../components/KVConsole";
import { LogStream } from "../components/LogStream";
import { MetricsPanel } from "../components/MetricsPanel";
import { Toggle } from "../components/Toggle";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useNode, type NodeStatus } from "../hooks/useNode";
import { flush } from "../lib/api";
import { logEvent } from "../lib/log";
import { useSimulator } from "../lib/simulator";
import { setSoundEnabled, useSoundEnabled } from "../lib/sound";
import { StarField } from "../components/StarField";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

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
  useDocumentTitle("InkCache // node console");

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

  return (
    <div className="ascii-scanlines relative min-h-screen overflow-hidden bg-void">
      <StarField count={140} />
      {booting && <BootSequence onDone={finishBoot} />}

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6">
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

              <span
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

        <div className="grid gap-4 lg:grid-cols-2">
          <KVConsole onOp={refreshNow} />
          {metrics ? (
            <MetricsPanel metrics={metrics} history={history} stale={status === "offline"} />
          ) : (
            <AsciiPanel title="metrics" right="no signal">
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

        <KeysPanel
          refreshToken={metrics ? metrics.sets + metrics.deletes + metrics.evictions : 0}
        />

        <LogStream />
      </div>
    </div>
  );
}
