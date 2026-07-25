import { useEffect, useRef } from "react";
import { clearLog, useLogEvents, type LogKind } from "../lib/log";
import { AsciiPanel } from "./AsciiPanel";

/**
 * Op stream as a log tail. Every line carries its kind as text (HIT/MISS/
 * SET/...), which is what makes the colour reinforcement rather than the
 * only signal — the op-kind palette is validated on that assumption.
 */
const KIND_STYLE: Record<LogKind, { label: string; text: string }> = {
  hit: { label: "HIT ", text: "text-kind-hit" },
  miss: { label: "MISS", text: "text-kind-miss" },
  set: { label: "SET ", text: "text-kind-set" },
  del: { label: "DEL ", text: "text-kind-del" },
  evict: { label: "EVCT", text: "text-kind-evict" },
  expire: { label: "EXPR", text: "text-kind-miss" },
  err: { label: "ERR ", text: "text-kind-err" },
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
    <AsciiPanel
      title="op stream"
      right={
        <button
          type="button"
          onClick={clearLog}
          className="cursor-pointer text-dim hover:text-bright"
          title="clear this log"
        >
          {events.length} events · [ clear ]
        </button>
      }
    >
      <div
        ref={scrollRef}
        className="max-h-44 overflow-y-auto border border-ghost bg-void p-3 text-xs leading-relaxed"
      >
        {events.length === 0 ? (
          <p className="text-faint">-- no operations yet; try the kv console --</p>
        ) : (
          events.map((ev) => {
            const style = KIND_STYLE[ev.kind];
            return (
              <div key={ev.id} className="whitespace-pre-wrap break-all">
                <span className="text-faint">{fmtTime(ev.at)}</span>{" "}
                <span className={style.text}>{style.label}</span>
                <span className="text-ghost"> │ </span>
                <span className="text-text">{ev.text}</span>
              </div>
            );
          })
        )}
      </div>
    </AsciiPanel>
  );
}
