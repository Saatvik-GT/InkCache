import { useCallback, useEffect, useState } from "react";
import { fetchMetrics, type NodeMetrics } from "./lib/api";
import { CRTScreen } from "./components/CRTScreen";
import { KVConsole } from "./components/KVConsole";
import { LogStream } from "./components/LogStream";
import { MetricsPanel } from "./components/MetricsPanel";
import { Panel } from "./components/Panel";

function App() {
  const [metrics, setMetrics] = useState<NodeMetrics | null>(null);

  const refreshMetrics = useCallback(() => {
    fetchMetrics()
      .then(setMetrics)
      .catch(() => setMetrics(null));
  }, []);

  useEffect(refreshMetrics, [refreshMetrics]);

  return (
    <CRTScreen>
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-5 p-4 sm:p-6">
        <header className="flex items-baseline justify-between border-b border-phos-dim pb-2">
          <h1 className="glow text-lg font-bold tracking-[0.3em] text-phos-bright">
            INKCACHE<span className="cursor-blink">█</span>
          </h1>
          <span className="text-xs text-phos-mid">single-node monitor // v0.1</span>
        </header>

        <div className="grid gap-5 lg:grid-cols-2">
          <KVConsole onOp={refreshMetrics} />
          {metrics ? (
            <MetricsPanel metrics={metrics} />
          ) : (
            <Panel title="METRICS" right="no signal">
              <p className="py-8 text-center text-phos-mid">-- node unreachable --</p>
            </Panel>
          )}
        </div>

        <LogStream />
      </div>
    </CRTScreen>
  );
}

export default App;
