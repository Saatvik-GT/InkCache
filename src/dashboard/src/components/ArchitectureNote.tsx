import { AsciiPanel } from "./AsciiPanel";

const ROWS: Array<{ state: string; label: string; tone: string }> = [
  { state: "[x]", label: "single-node cache core, TTL + access-aware eviction", tone: "text-text" },
  { state: "[x]", label: "REST API with real latency instrumentation", tone: "text-text" },
  { state: "[x]", label: "this console — every figure read off a live node", tone: "text-text" },
  { state: "[ ]", label: "multi-node replication", tone: "text-dim" },
  { state: "[ ]", label: "consistent hashing / node discovery", tone: "text-dim" },
  { state: "[ ]", label: "trained prefetching model", tone: "text-dim" },
];

export function ArchitectureNote() {
  return (
    <AsciiPanel title="where this actually is" right="status">
      <ul className="space-y-1 text-xs">
        {ROWS.map((r) => (
          <li key={r.label} className={`flex gap-2 ${r.tone}`}>
            <span className={r.state === "[x]" ? "text-accent" : "text-faint"}>{r.state}</span>
            <span>{r.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] leading-relaxed text-dim">
        Checked boxes are real and running. Unchecked are roadmap — the architecture diagram in the
        README describes the destination, not today.{" "}
        <a
          href="https://github.com/Saatvik-GT/InkCache#current-status"
          target="_blank"
          rel="noreferrer"
          className="text-accent underline underline-offset-2"
        >
          Current Status
        </a>
      </p>
    </AsciiPanel>
  );
}
