import { AsciiPanel } from "./AsciiPanel";

const FEATURES = [
  {
    id: "01",
    title: "access-aware eviction",
    body: "Samples the least-recently-used keys and evicts whichever was read the fewest times — frequency over a recency window, not plain LRU.",
  },
  {
    id: "02",
    title: "real rest api",
    body: "set / get / delete / keys / flush / metrics / health, with per-op latency instrumentation and JSON errors on every path.",
  },
  {
    id: "03",
    title: "live instrumentation",
    body: "Block-glyph meters, sparklines and an access-frequency heat map — every figure is read off the running node, nothing mocked.",
  },
  {
    id: "04",
    title: "synthesized cues",
    body: "Web Audio blips per event kind, generated at runtime rather than sampled. Off by default.",
  },
];

export function FeatureCards() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {FEATURES.map((f) => (
        <AsciiPanel key={f.id} title={f.title} right={f.id}>
          <p className="text-xs leading-relaxed text-text">{f.body}</p>
        </AsciiPanel>
      ))}
    </div>
  );
}
