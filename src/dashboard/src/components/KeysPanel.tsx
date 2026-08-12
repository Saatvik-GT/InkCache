import type { KeyStat } from "../lib/api.js";
import { AsciiPanel } from "./AsciiPanel";

/** Shade ramp for access frequency — colourless, so it survives being read
    in monochrome and doesn't lean on hue to carry a quantity. */
const HEAT = "░▒▓█";

function heatGlyph(hits: number, max: number): string {
  if (hits === 0) return HEAT[0]!;
  const t = max > 0 ? hits / max : 0;
  return HEAT[Math.min(HEAT.length - 1, Math.max(1, Math.ceil(t * (HEAT.length - 1))))]!;
}

/**
 * Access-frequency heat map. Density is carried by the glyph itself rather
 * than a background tint, so the ranking is legible in a screenshot, in
 * monochrome, and to anyone who can't separate the hue steps.
 */
/** Takes stats as a prop rather than fetching its own -- see TopKeysChart's
    header comment, which renders alongside this from the same shared fetch. */
export function KeysPanel({ stats }: { stats: KeyStat[] | null }) {
  const maxHits = stats ? Math.max(0, ...stats.map((s) => s.hits)) : 0;
  const sorted = stats ? [...stats].sort((a, b) => b.hits - a.hits) : null;

  return (
    <AsciiPanel
      title="keys"
      right={
        sorted ? (
          <span className="flex items-center gap-2">
            <span aria-hidden className="ascii-grid text-dim">
              {HEAT}
            </span>
            <span>{sorted.length} live</span>
          </span>
        ) : (
          "--"
        )
      }
      className="h-full"
      bodyClassName="flex flex-col"
    >
      <div className="ascii-scroll min-h-0 flex-1 overflow-y-auto text-xs">
        {sorted === null ? (
          <p className="text-dim">-- no signal --</p>
        ) : sorted.length === 0 ? (
          <p className="text-faint">-- store empty --</p>
        ) : (
          <ul className="space-y-0.5">
            {sorted.map(({ key, hits, ttl }) => (
              <li key={key} className="flex items-baseline gap-2" title={`${key} — ${hits} reads`}>
                <span aria-hidden className="ascii-grid shrink-0 text-accent">
                  {heatGlyph(hits, maxHits)}
                </span>
                <span className="min-w-0 flex-1 truncate text-text">{key}</span>
                {ttl !== null && <span className="shrink-0 text-faint">{ttl.toFixed(0)}s</span>}
                <span className="w-8 shrink-0 text-right text-dim">{hits}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AsciiPanel>
  );
}
