export function ArchitectureNote() {
  return (
    <div className="neu-raised rounded-lg p-4 text-left text-xs text-ink-mid">
      <span className="mb-1 block text-[10px] font-bold tracking-widest text-ink uppercase">
        where this actually is
      </span>
      A working single-node cache core, REST API, and this dashboard are real
      and running today — every number on this page comes from a live node,
      nothing is mocked. Multi-node replication, consistent hashing, and a
      trained/learned prefetching layer are roadmap items, not built yet. See{" "}
      <a
        href="https://github.com/Saatvik-GT/InkCache#current-status"
        target="_blank"
        rel="noreferrer"
        className="text-accent underline underline-offset-2"
      >
        Current Status
      </a>{" "}
      in the README for the full breakdown.
    </div>
  );
}
