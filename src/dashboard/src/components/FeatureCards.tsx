const FEATURES = [
  {
    title: "Access-aware eviction",
    body: "Samples the least-recently-used keys and evicts whichever was read the fewest times — a frequency-over-recency heuristic, not just plain LRU.",
  },
  {
    title: "Real REST API",
    body: "set/get/delete/keys/flush/metrics/health, with per-op latency instrumentation and JSON errors instead of stack traces.",
  },
  {
    title: "Live visualizations",
    body: "Circular + needle gauges, real sparklines, an access-frequency heat map — every number comes from the running node, nothing mocked.",
  },
  {
    title: "Synthesized sound cues",
    body: "Web Audio blips per event kind, generated on the fly — no audio files, off by default.",
  },
];

export function FeatureCards() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {FEATURES.map((f) => (
        <div key={f.title} className="neu-raised rounded-lg p-4 text-left">
          <h3 className="mb-1 text-xs font-bold tracking-widest text-accent uppercase">
            {f.title}
          </h3>
          <p className="text-xs text-ink-mid">{f.body}</p>
        </div>
      ))}
    </div>
  );
}
