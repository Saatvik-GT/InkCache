import { useState } from "react";

const SNIPPET = `curl -X POST http://localhost:8080/set \\
  -H "Content-Type: application/json" \\
  -d '{"key":"user:1","value":"saatvik","ttl":300}'`;

export function QuickStart() {
  const [copied, setCopied] = useState(false);

  return (
    <div className="neu-inset rounded-md p-4 text-left">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] tracking-widest text-ink-mid uppercase">quick start</span>
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
          className="cursor-pointer text-[10px] text-ink-mid hover:text-ink"
        >
          {copied ? "copied" : "⧉ copy"}
        </button>
      </div>
      <pre className="overflow-x-auto text-xs text-ink">
        <code>{SNIPPET}</code>
      </pre>
    </div>
  );
}
