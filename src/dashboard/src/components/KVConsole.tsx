import { useEffect, useRef, useState } from "react";
import { deleteKey, describeFetchError, flush, getKey, setKey } from "../lib/api";
import { logEvent } from "../lib/log";
import { Button } from "./Button";
import { KeyCap } from "./KeyCap";
import { AsciiPanel } from "./AsciiPanel";

type Tone = "plain" | "ok" | "hit" | "miss" | "err";

interface Line {
  text: string;
  tone: Tone;
}

const TONE_CLASS: Record<Tone, string> = {
  plain: "text-dim",
  ok: "text-accent",
  hit: "text-kind-hit",
  miss: "text-kind-miss",
  err: "text-kind-err",
};

// Matches the console output's own cap (see print() below) — without one,
// a long-running session (this is a terminal meant to be left open) grows
// the recall history without bound, unlike every other array in this file
// and codebase (log events, latency samples, metrics history), which all
// cap themselves.
const HISTORY_CAP = 200;

const HELP: string[] = [
  "set <key> <value> [ttlSec]   store a value (quote values with spaces)",
  "get <key>                    read a value",
  "del <key>                    remove a key (alias: delete)",
  "flush                        clear every key in the store",
  "clear                        clear this console",
];

/** Split a command line into tokens, honouring double quotes. */
function tokenize(input: string): string[] {
  const matches = input.match(/"([^"]*)"|\S+/g) ?? [];
  // An unterminated quote (`set foo "bar`) doesn't match the quoted
  // alternative, so it falls through to \S+ as one raw token starting with
  // a literal quote — stripping first/last char there would silently drop
  // the token's real last character instead of leaving it untouched.
  return matches.map((t) =>
    t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t,
  );
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
  const [lastValue, setLastValue] = useState<string | null>(null);
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
            setLastValue(res.value ?? null);
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
      const msg = describeFetchError(err);
      print(`ERR  ${msg}`, "err");
      logEvent("err", msg);
    }
  }

  function submit() {
    const cmd = input.trim();
    if (!cmd) return;
    setHistory((prev) => [...prev.slice(-(HISTORY_CAP - 1)), cmd]);
    setHistIdx(-1);
    setInput("");
    setBusy(true);
    void run(cmd).finally(() => setBusy(false));
  }

  return (
    <AsciiPanel
      title="kv console"
      right={busy ? <span className="cursor-blink text-accent">tx…</span> : "/ to focus"}
      className="h-full"
      bodyClassName="flex flex-col"
    >
      {/* Grows to fill whatever height the grid cell gives it, so the three
          bottom panels line up instead of each ending at its own height. */}
      <div
        ref={scrollRef}
        aria-live="polite"
        className="ascii-scroll min-h-0 flex-1 overflow-y-auto border border-ghost bg-void p-3 text-xs leading-relaxed whitespace-pre-wrap break-all"
      >
        {lines.map((line, i) => (
          <div key={i} className={TONE_CLASS[line.tone]}>
            {line.text}
          </div>
        ))}
      </div>
      <form
        className="mt-3 flex shrink-0 items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-1 items-center gap-2 border border-ghost bg-void px-3 py-2 focus-within:border-accent">
          <span className="text-accent">&gt;</span>
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
            className="w-full bg-transparent text-bright outline-none placeholder:text-faint disabled:opacity-50"
            placeholder="set user:1 saatvik 300"
          />
        </div>
        <Button type="submit" tone="accent" title="run the command (Enter)" disabled={busy}>
          run
        </Button>
      </form>

      <div className="mt-3 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-faint">
        <span className="flex items-center gap-1">
          <KeyCap>/</KeyCap> focus
        </span>
        <span className="flex items-center gap-1">
          <KeyCap>↑</KeyCap>
          <KeyCap>↓</KeyCap> history
        </span>
        <span className="flex items-center gap-1">
          <KeyCap>Esc</KeyCap> clear input
        </span>
        <span className="flex items-center gap-1">
          <KeyCap>S</KeyCap> sim
        </span>
        <span className="flex items-center gap-1">
          <KeyCap>M</KeyCap> sound
        </span>
        {lastValue !== null && (
          <button
            type="button"
            onClick={() => {
              // navigator.clipboard is undefined in a non-secure context or
              // an old browser — accessing .writeText on it would throw
              // synchronously, before any .catch() could attach, leaving
              // the user with no feedback at all instead of the error line.
              if (!navigator.clipboard) {
                print("clipboard write failed", "err");
                return;
              }
              navigator.clipboard
                .writeText(lastValue)
                .then(() => print("copied last value to clipboard", "ok"))
                .catch(() => print("clipboard write failed", "err"));
            }}
            className="ml-auto cursor-pointer text-dim hover:text-bright"
            title="copy the last GET result to the clipboard"
          >
            ⧉ copy last value
          </button>
        )}
      </div>
    </AsciiPanel>
  );
}
