import type { ReactNode } from "react";

/**
 * Full-viewport CRT tube: scanlines, vignette, a slow refresh sweep and a
 * faint flicker. Purely presentational — every child renders "on the glass".
 */
export function CRTScreen({ children }: { children: ReactNode }) {
  return (
    <div className="crt-scanlines crt-vignette relative min-h-screen overflow-hidden bg-crt">
      <div className="crt-sweep" aria-hidden />
      <div className="crt-flicker relative z-10 min-h-screen">{children}</div>
    </div>
  );
}
