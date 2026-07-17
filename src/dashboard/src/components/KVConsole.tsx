import { useEffect, useRef, useState } from "react";
import { deleteKey, flush, getKey, setKey } from "../lib/api";
import { logEvent } from "../lib/log";
import { Panel } from "./Panel";

type Tone = "plain" | "ok" | "hit" | "miss" | "err";

interface Line {
  text: string;
  tone: Tone;
}

const TONE_CLASS: Record<Tone, string> = {
  plain: "text-phos-mid",
  ok: "text-phos",
  hit: "text-phos-bright glow",
  miss: "text-sig-amber glow-amber",
  err: "text-sig-red glow-red",
};

const HELP: string[] = [
  "set <key> <value> [ttlSec]   store a value (quote values with spaces)",
  "get <key>                    read a value",
  "del <key>                    remove a key",
  "flush                        clear every key in the store",
  "clear                        clear this console",
];

/** Split a command line into tokens, honouring double quotes. */
function tokenize(input: string): string[] {
  const matches = input.match(/"([^"]*)"|\S+/g) ?? [];
  return matches.map((t) => (t.startsWith('"') ? t.slice(1, -1) : t));
}

export function KVConsole({
  onOp,
}: {
  /** Fired after every completed cache operation so siblings can refresh/log. */
  onOp?: (event: { op: "set" | "get" | "del" | "flush"; key: string; outcome: string }) => void;
}) {
  const [lines, setLines] = useState<Line[]>([
    { text: "inkcache kv console — type `help` or press / to focus", tone: "plain" },
  ]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  const print = (text: string, tone: Tone = "plain") =>
    setLines((prev) => [...prev.slice(-199), { text, tone }]);

  async function run(raw: string) {
    const [cmd, ...args] = tokenize(raw);
    if (!cmd) return;
    print(`> ${raw}`, "plain");

    try {
      switch (cmd.toLowerCase()) {
        case "help":
          HELP.forEach((l) => print(l, "plain"));
          break;
        case "clear":
          setLines([]);
          break;
        case "set": {
          const [key, value, ttlRaw] = args;
          if (!key || value === undefined) return print("usage: set <key> <value> [ttlSec]", "err");
          const ttl = ttlRaw !== undefined ? Number(ttlRaw) : undefined;
          if (ttl !== undefined && (!Number.isFinite(ttl) || ttl <= 0))
            return print("ttl must be a positive number of seconds", "err");
          await setKey(key, value, ttl);
          print(`OK  stored "${key}"${ttl ? ` (ttl ${ttl}s)` : ""}`, "ok");
          logEvent("set", `${key}${ttl ? ` ttl=${ttl}s` : ""}`);
          onOp?.({ op: "set", key, outcome: "stored" });
          break;
        }
        case "get": {
          const [key] = args;
          if (!key) return print("usage: get <key>", "err");
          const res = await getKey(key);
          if (res.hit) {
            const ttlNote = res.ttl != null ? `  (ttl ${res.ttl.toFixed(1)}s)` : "";
            print(`HIT  "${key}" = ${JSON.stringify(res.value)}${ttlNote}`, "hit");
            logEvent("hit", key);
            onOp?.({ op: "get", key, outcome: "hit" });
          } else {
            print(`MISS "${key}"`, "miss");
            logEvent("miss", key);
            onOp?.({ op: "get", key, outcome: "miss" });
          }
          break;
        }
        case "flush": {
          const res = await flush();
          print(
            `OK  flushed store — dropped ${res.dropped} key${res.dropped === 1 ? "" : "s"}`,
            "ok",
          );
          logEvent(
            "del",
            `flushed store — dropped ${res.dropped} key${res.dropped === 1 ? "" : "s"}`,
          );
          onOp?.({ op: "flush", key: "*", outcome: "flushed" });
          break;
        }
        case "del":
        case "delete": {
          const [key] = args;
          if (!key) return print("usage: del <key>", "err");
          const res = await deleteKey(key);
          print(
            res.deleted ? `OK  deleted "${key}"` : `NOOP "${key}" not present`,
            res.deleted ? "ok" : "plain",
          );
          if (res.deleted) logEvent("del", key);
          onOp?.({ op: "del", key, outcome: res.deleted ? "deleted" : "absent" });
          break;
        }
        default:
          print(`unknown command: ${cmd} — try \`help\``, "err");
      }
    } catch (err) {
      // fetch throws TypeError when the node itself is down, not just on bad input
      const msg =
        err instanceof TypeError
          ? "node unreachable — is the cache node running?"
          : err instanceof Error
            ? err.message
            : String(err);
      print(`ERR  ${msg}`, "err");
      logEvent("err", msg);
    }
  }

  return (
    <Panel
      title="KV CONSOLE"
      right={busy ? <span className="cursor-blink">tx…</span> : "press / to focus"}
      className="flex flex-col"
    >
      <div ref={scrollRef} className="h-48 overflow-y-auto whitespace-pre-wrap break-all leading-5">
        {lines.map((line, i) => (
          <div key={i} className={TONE_CLASS[line.tone]}>
            {line.text}
          </div>
        ))}
      </div>
      <form
        className="mt-2 flex items-center gap-2 border-t border-phos-faint pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          const cmd = input.trim();
          if (!cmd) return;
          setHistory((prev) => [...prev, cmd]);
          setHistIdx(-1);
          setInput("");
          setBusy(true);
          void run(cmd).finally(() => setBusy(false));
        }}
      >
        <span className="glow text-phos-bright">&gt;</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Shell-style history recall
            if (e.key === "ArrowUp") {
              e.preventDefault();
              const idx = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1);
              if (history[idx] !== undefined) {
                setHistIdx(idx);
                setInput(history[idx]);
              }
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              if (histIdx === -1) return;
              const idx = histIdx + 1;
              if (idx >= history.length) {
                setHistIdx(-1);
                setInput("");
              } else {
                setHistIdx(idx);
                setInput(history[idx] ?? "");
              }
            } else if (e.key === "Escape") {
              setInput("");
              setHistIdx(-1);
            }
          }}
          spellCheck={false}
          autoComplete="off"
          disabled={busy}
          className="w-full bg-transparent text-phos-bright caret-phos-bright outline-none placeholder:text-phos-dim disabled:opacity-50"
          placeholder="set user:1 saatvik 300"
        />
      </form>
    </Panel>
  );
}
