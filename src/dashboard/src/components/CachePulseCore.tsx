import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * The central node — an icosahedron that breathes (scale pulse) at a rate
 * tied to real ops/s, and glows brighter as real hit rate climbs. hitRate
 * null (no data yet) renders as a dim, still core rather than guessing.
 */
export function CachePulseCore({
  hitRate,
  opsPerSec,
  reducedMotion = false,
}: {
  hitRate: number | null;
  opsPerSec: number;
  /** Freeze the breathing scale animation; the glow (a data readout, not
      decorative motion) keeps updating either way. */
  reducedMotion?: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const t = useRef(0);

  useFrame((_, delta) => {
    if (meshRef.current) {
      if (reducedMotion) {
        meshRef.current.scale.setScalar(1);
      } else {
        // Pulse speed scales with real throughput; idle (0 ops/s) still
        // breathes slowly so the core doesn't look frozen when quiet.
        t.current += delta * (1 + Math.min(opsPerSec, 20) * 0.15);
        meshRef.current.scale.setScalar(1 + Math.sin(t.current) * 0.06);
      }
    }
    if (materialRef.current) {
      const glow = hitRate === null ? 0.15 : 0.25 + hitRate * 0.9;
      materialRef.current.emissiveIntensity = glow;
    }
  });

  return (
    <mesh ref={meshRef}>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial
        ref={materialRef}
        color="#0d9488"
        emissive="#0d9488"
        emissiveIntensity={0.15}
        roughness={0.3}
        metalness={0.4}
      />
    </mesh>
  );
}
