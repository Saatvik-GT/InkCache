import { CRTScreen } from "./components/CRTScreen";
import { KVConsole } from "./components/KVConsole";
import { Panel } from "./components/Panel";

function App() {
  return (
    <CRTScreen>
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-5 p-4 sm:p-6">
        <header className="flex items-baseline justify-between border-b border-phos-dim pb-2">
          <h1 className="glow text-lg font-bold tracking-[0.3em] text-phos-bright">
            INKCACHE<span className="cursor-blink">█</span>
          </h1>
          <span className="text-xs text-phos-mid">
            single-node monitor // v0.1
          </span>
        </header>

        <KVConsole />

        <Panel title="SYS" right="stand by">
          <p className="text-phos-mid">awaiting subsystems — metrics, log stream</p>
        </Panel>
      </div>
    </CRTScreen>
  );
}

export default App;
