/**
 * Static stand-in for the 3D hero — shown when WebGL isn't available or the
 * scene threw at runtime. A flat CSS ring instead of the real geometry, not
 * a broken canvas or an empty box.
 */
export function Scene3DFallback() {
  return (
    <div className="neu-inset flex h-full w-full flex-col items-center justify-center gap-3 rounded-lg p-6">
      <div
        className="neu-raised-sm h-20 w-20 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 35% 35%, var(--color-accent), var(--color-base-raised) 70%)",
        }}
        aria-hidden
      />
      <p className="text-xs text-ink-mid">-- 3D preview unavailable in this browser --</p>
    </div>
  );
}
