import { useEffect, useRef } from "react";
import { clearLog, useLogEvents, type LogKind } from "../lib/log";
import { Panel } from "./Panel";

/**
 * Op stream: each line gets a left accent border in its kind's color plus
 * a text label — the validated op-kind palette (see index.css) is checked
 * for CVD/contrast as a set, but color is still never the only signal.
 */
const KIND_STYLE: Record<LogKind, { label: string; border: string; text: string }> = {
  hit: { label: "HIT ", border: "border-kind-hit", text: "text-kind-hit" },
  miss: { label: "MISS", border: "border-kind-miss", text: "text-kind-miss" },
  set: { label: "SET ", border: "border-kind-set", text: "text-kind-set" },
  del: { label: "DEL ", border: "border-kind-del", text: "text-kind-del" },
  evict: { label: "EVCT", border: "border-kind-evict", text: "text-kind-evict" },
  expire: { label: "EXPR", border: "border-kind-miss", text: "text-kind-miss" },
  err: { label: "ERR ", border: "border-kind-err", text: "text-kind-err" },
};

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", { hour12: false });
}

export function LogStream() {
  const events = useLogEvents();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [events]);

  return (
    <Panel
      title="OP STREAM"
      right={
        <button
          type="button"
          onClick={clearLog}
          className="cursor-pointer text-ink-mid hover:text-ink"
          title="clear this log"
        >
          {events.length} events · clear
        </button>
      }
    >
      <div className="retro-perf rounded-t-md" />
      <div
        ref={scrollRef}
        className="retro-dotfield neu-inset flex max-h-44 flex-col overflow-y-auto rounded-b-md p-3"
      >
        {events.length === 0 ? (
          <p className="text-ink-faint">-- no operations yet; try the kv console --</p>
        ) : (
          events.map((ev) => {
            const style = KIND_STYLE[ev.kind];
            return (
              <div
                key={ev.id}
                className={`border-b border-dotted border-ink-faint/40 py-1 pl-2 whitespace-pre-wrap break-all last:border-b-0 ${style.border} border-l-2`}
              >
                <span className="text-ink-faint">{fmtTime(ev.at)} </span>
                <span className={`font-bold ${style.text}`}>{style.label}</span>
                <span className="text-ink-mid"> │ </span>
                <span className="text-ink">{ev.text}</span>
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}
