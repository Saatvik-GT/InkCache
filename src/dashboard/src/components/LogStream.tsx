import { useEffect, useRef } from "react";
import { clearLog, useLogEvents, type LogKind } from "../lib/log";
import { Panel } from "./Panel";

/**
 * Color-coded op stream. Every line carries its label glyph, so the event
 * type is readable without color (CVD/print safe).
 */
const KIND_STYLE: Record<LogKind, { label: string; className: string }> = {
  hit: { label: "HIT ", className: "text-phos-bright" },
  miss: { label: "MISS", className: "text-sig-amber" },
  set: { label: "SET ", className: "text-phos" },
  del: { label: "DEL ", className: "text-phos-mid" },
  evict: { label: "EVCT", className: "text-sig-red" },
  expire: { label: "EXPR", className: "text-sig-amber-dim" },
  err: { label: "ERR ", className: "text-sig-red glow-red" },
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
          className="cursor-pointer text-phos-mid hover:text-phos hover:glow"
          title="clear this log"
        >
          {events.length} events · clear
        </button>
      }
    >
      <div ref={scrollRef} className="h-44 overflow-y-auto leading-5">
        {events.length === 0 ? (
          <p className="text-phos-dim">-- no operations yet; try the kv console --</p>
        ) : (
          events.map((ev) => {
            const style = KIND_STYLE[ev.kind];
            return (
              <div key={ev.id} className="whitespace-pre-wrap break-all">
                <span className="text-phos-dim">{fmtTime(ev.at)} </span>
                <span className={style.className}>{style.label}</span>
                <span className="text-phos-mid"> │ </span>
                <span className={style.className}>{ev.text}</span>
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}
