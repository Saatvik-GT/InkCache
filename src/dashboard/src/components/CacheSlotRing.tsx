import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const SLOT_COUNT = 24;

/**
 * A ring of instanced cubes standing in for cache slots — one instanced
 * mesh, not 24 separate mesh components, so this stays cheap regardless of
 * count. Static geometry for now; rotation speed and per-slot color react
 * to real metrics in the next commits.
 */
export function CacheSlotRing({
  radius = 2.2,
  rotationSpeed = 0.15,
  reducedMotion = false,
}: {
  radius?: number;
  rotationSpeed?: number;
  /** Skip the per-frame rotation entirely — a still ring, not just a slower one. */
  reducedMotion?: boolean;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const angle = (i / SLOT_COUNT) * Math.PI * 2;
      dummy.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      dummy.rotation.set(0, angle, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [radius, dummy]);

  useFrame((_, delta) => {
    if (reducedMotion || !meshRef.current) return;
    meshRef.current.rotation.y += rotationSpeed * delta;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, SLOT_COUNT]}>
      <boxGeometry args={[0.28, 0.28, 0.28]} />
      {/* meshPhysicalMaterial's clearcoat + transparency read as glass —
          matches the dashboard's glassmorphism theme. Not full transmission
          (that render pass doesn't play well with instancing at this count). */}
      <meshPhysicalMaterial
        color="#2563eb"
        roughness={0.15}
        metalness={0.3}
        clearcoat={1}
        clearcoatRoughness={0.1}
        transparent
        opacity={0.85}
      />
    </instancedMesh>
  );
}
