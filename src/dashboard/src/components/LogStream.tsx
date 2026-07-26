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

/** Distance from the bottom, in px, still counted as "following the tail". */
const STICK_THRESHOLD = 24;

export function LogStream() {
  const events = useLogEvents();
  const scrollRef = useRef<HTMLDivElement>(null);
  // Whether to keep pinning to the newest entry. Scrolling up to read
  // history sets this false, so an incoming event doesn't yank the view
  // back to the bottom mid-read — `tail -f` behaviour, not a hard snap.
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [events]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
  };

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
      className="h-full"
      bodyClassName="flex flex-col"
    >
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="ascii-scroll min-h-0 flex-1 overflow-y-auto border border-ghost bg-void p-3 text-xs leading-relaxed"
      >
        {events.length === 0 ? (
          <p className="text-faint">-- no operations yet; try the kv console --</p>
        ) : (
          events.map((ev) => {
            const style = KIND_STYLE[ev.kind];
            return (
              // Columns rather than one wrapping string: a long key used to
              // break mid-token and restart at column 0, which read as a
              // separate entry. Now the message wraps inside its own column,
              // staying aligned under itself.
              <div key={ev.id} className="flex gap-1.5">
                <span className="shrink-0 text-faint">{fmtTime(ev.at)}</span>
                <span className={`shrink-0 ${style.text}`}>{style.label}</span>
                <span className="min-w-0 flex-1 text-text wrap-break-word">{ev.text}</span>
              </div>
            );
          })
        )}
      </div>
    </AsciiPanel>
  );
}
