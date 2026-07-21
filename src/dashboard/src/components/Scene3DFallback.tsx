/**
 * Static stand-in for the 3D hero. Used for two different situations that
 * need different copy: still downloading the three.js chunk (temporary —
 * pulses, "loading") vs. WebGL unsupported or a runtime crash (permanent —
 * still, "unavailable"). Saying "unavailable" while it's actually just
 * loading would be a lie the user has no way to tell apart from the real
 * failure state.
 */
export function Scene3DFallback({ loading = false }: { loading?: boolean }) {
  return (
    <div className="neu-inset flex h-full w-full flex-col items-center justify-center gap-3 rounded-lg p-6">
      <div
        className={`neu-raised-sm h-20 w-20 rounded-full ${loading ? "animate-pulse" : ""}`}
        style={{
          background:
            "radial-gradient(circle at 35% 35%, var(--color-accent), var(--color-base-raised) 70%)",
        }}
        aria-hidden
      />
      <p className="text-xs text-ink-mid">
        {loading ? "-- loading 3D preview... --" : "-- 3D preview unavailable in this browser --"}
      </p>
    </div>
  );
}
