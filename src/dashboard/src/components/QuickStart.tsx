import { useState } from "react";
import { AsciiPanel } from "./AsciiPanel";

const SNIPPET = `curl -X POST http://localhost:8080/set \\
  -H "Content-Type: application/json" \\
  -d '{"key":"user:1","value":"saatvik","ttl":300}'`;

export function QuickStart() {
  const [copied, setCopied] = useState(false);

  return (
    <AsciiPanel
      title="quick start"
      right={
        <button
          type="button"
          onClick={() => {
            navigator.clipboard
              .writeText(SNIPPET)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
              .catch(() => {});
          }}
          className="cursor-pointer text-dim hover:text-bright"
        >
          {copied ? "[ copied ]" : "[ copy ]"}
        </button>
      }
    >
      <pre className="ascii-grid overflow-x-auto text-[11px] leading-relaxed text-text">
        <code>{SNIPPET}</code>
      </pre>
    </AsciiPanel>
  );
}
