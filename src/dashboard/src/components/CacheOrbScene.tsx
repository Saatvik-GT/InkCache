import { Canvas } from "@react-three/fiber";

/**
 * 3D hero scene — a real Three.js canvas, not a static render. Starts as a
 * bare camera+lighting rig with one placeholder mesh; the actual cache-slot
 * ring and data wiring land in the commits that follow, each verified on
 * its own so a mistake in the geometry math doesn't also hide a broken
 * render pipeline.
 */
export function CacheOrbScene() {
  return (
    <Canvas camera={{ position: [0, 0, 6], fov: 45 }} dpr={[1, 1.5]}>
      <ambientLight intensity={0.4} />
      <pointLight position={[4, 4, 4]} intensity={1.2} color="#0d9488" />
      <mesh>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#0d9488" roughness={0.3} metalness={0.4} />
      </mesh>
    </Canvas>
  );
}
