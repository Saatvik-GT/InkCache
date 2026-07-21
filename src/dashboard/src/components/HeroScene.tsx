import { lazy, Suspense, useState } from "react";
import { Scene3DBoundary } from "./Scene3DBoundary";
import { Scene3DFallback } from "./Scene3DFallback";
import { hasWebGL } from "../lib/webgl";

// Code-split: three.js + @react-three/* only get downloaded when someone
// actually lands on the home page, never as part of the /dashboard bundle.
const CacheOrbScene = lazy(() =>
  import("./CacheOrbScene").then((m) => ({ default: m.CacheOrbScene })),
);

/**
 * Ties the 3D hero together: skip mounting the Canvas at all if WebGL isn't
 * available (checked once, not per-render), show the static fallback while
 * the three.js chunk downloads, and catch any runtime failure so a broken
 * driver degrades gracefully instead of taking the page down.
 */
export function HeroScene({ hitRate, opsPerSec }: { hitRate: number | null; opsPerSec: number }) {
  const [webglOk] = useState(hasWebGL);

  if (!webglOk) return <Scene3DFallback />;

  return (
    <Scene3DBoundary fallback={<Scene3DFallback />}>
      <Suspense fallback={<Scene3DFallback />}>
        <CacheOrbScene hitRate={hitRate} opsPerSec={opsPerSec} />
      </Suspense>
    </Scene3DBoundary>
  );
}
