import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { CacheSlotRing } from "./CacheSlotRing";

/**
 * 3D hero scene: a pulsing core (the node) orbited by a ring of cache-slot
 * cubes. Real Three.js, not a static render — data wiring (hit rate → core
 * glow, ops/s → ring rotation speed) lands in the next commit.
 */
export function CacheOrbScene() {
  return (
    <Canvas camera={{ position: [0, 2, 6], fov: 45 }} dpr={[1, 1.5]}>
      <ambientLight intensity={0.4} />
      <pointLight position={[4, 4, 4]} intensity={1.2} color="#0d9488" />
      <mesh>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#0d9488" roughness={0.3} metalness={0.4} />
      </mesh>
      <CacheSlotRing />
      <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.6} />
    </Canvas>
  );
}
