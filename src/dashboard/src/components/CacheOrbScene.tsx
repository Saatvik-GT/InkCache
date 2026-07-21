import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { CachePulseCore } from "./CachePulseCore";
import { CacheSlotRing } from "./CacheSlotRing";

/**
 * 3D hero scene: a pulsing core (the node) orbited by a ring of cache-slot
 * cubes. hitRate/opsPerSec come from the real /metrics poll — null hitRate
 * (no traffic yet) renders as a dim, still core rather than a fake number.
 */
export function CacheOrbScene({
  hitRate,
  opsPerSec,
}: {
  hitRate: number | null;
  opsPerSec: number;
}) {
  // Ring spins faster with more traffic, capped so it never becomes
  // nauseating (or reads as a rendering bug) at high ops/s.
  const ringSpeed = 0.08 + Math.min(opsPerSec, 30) * 0.02;

  return (
    <Canvas camera={{ position: [0, 2, 6], fov: 45 }} dpr={[1, 1.5]}>
      <ambientLight intensity={0.4} />
      <pointLight position={[4, 4, 4]} intensity={1.2} color="#0d9488" />
      <CachePulseCore hitRate={hitRate} opsPerSec={opsPerSec} />
      <CacheSlotRing rotationSpeed={ringSpeed} />
      <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.6} />
    </Canvas>
  );
}
