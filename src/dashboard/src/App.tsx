import { CRTScreen } from "./components/CRTScreen";
import { KVConsole } from "./components/KVConsole";
import { LogStream } from "./components/LogStream";
import { MetricsPanel } from "./components/MetricsPanel";
import { Panel } from "./components/Panel";
import { useNode, type NodeStatus } from "./hooks/useNode";

const STATUS_BADGE: Record<NodeStatus, { glyph: string; label: string; className: string }> = {
  connecting: { glyph: "◌", label: "CONNECTING", className: "text-phos-mid" },
  online: { glyph: "●", label: "ONLINE", className: "text-phos-bright glow" },
  offline: { glyph: "○", label: "OFFLINE", className: "text-sig-red glow-red" },
};

function App() {
  const { metrics, status, refreshNow } = useNode(1000);
  const badge = STATUS_BADGE[status];

  return (
    <CRTScreen>
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-5 p-4 sm:p-6">
        <header className="flex items-baseline justify-between border-b border-phos-dim pb-2">
          <h1 className="glow text-lg font-bold tracking-[0.3em] text-phos-bright">
            INKCACHE<span className="cursor-blink">█</span>
          </h1>
          <div className="flex items-baseline gap-4 text-xs">
            <span className="text-phos-mid">single-node monitor // v0.1</span>
            <span className={badge.className}>
              {badge.glyph} {badge.label}
            </span>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-2">
          <KVConsole onOp={refreshNow} />
          {metrics ? (
            <MetricsPanel metrics={metrics} />
          ) : (
            <Panel title="METRICS" right="no signal">
              <p className="py-8 text-center text-phos-mid">
                {status === "connecting" ? "-- acquiring signal --" : "-- node unreachable --"}
              </p>
            </Panel>
          )}
        </div>

        <LogStream />
      </div>
    </CRTScreen>
  );
}

export default App;
