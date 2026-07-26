/**
 * Character-grid sphere renderer — real 3D projection with a depth buffer
 * and diffuse lighting, rasterized to text instead of pixels. No WebGL and
 * no dependency: this is the same math a shader would do, resolved at
 * character resolution.
 *
 * Why it reads as a rotating solid rather than a spinning gradient: the
 * light is fixed in world space (like a sun) while the crater field lives
 * in *object* space, so surface features travel through a stationary
 * terminator as the sphere turns. Rotating the light with the body instead
 * would look like a flat disc with a moving highlight.
 */

/** Dark to bright. Index 0 is unlit space; the ramp doubles as the shading scale. */
export const LUMA_RAMP = " .·:;+=*oO0@";

/**
 * A monospace cell is roughly 0.6em wide by 1em tall, so a circle needs
 * more columns than rows to avoid rendering as an egg. The pure ratio is
 * 1/0.6 = 1.667, but rasterizing to whole cells rounds the vertical extent
 * out further than the horizontal, which left the body ~4.5% tall. 1.73 is
 * that measured correction, not a guess — see the roundness test.
 */
const CHAR_ASPECT = 1.73;

/** Fixed world-space light. Upper-left, slightly toward the viewer. */
const LIGHT = normalize([-0.55, -0.5, 0.68]);

/**
 * Crater centers as unit vectors in object space, generated once from a
 * fixed sequence so the moon's face is identical on every load (a
 * re-randomized surface every refresh would read as noise, not terrain).
 * Spread via the golden-angle spiral, which distributes points on a sphere
 * far more evenly than independent random sampling.
 */
const CRATERS = buildCraters(18);

function buildCraters(count: number): Array<{ v: Vec3; radius: number; depth: number }> {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out: Array<{ v: Vec3; radius: number; depth: number }> = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    // Deterministic per-index jitter so the craters aren't a visible spiral.
    const wobble = Math.sin(i * 12.9898) * 0.5 + 0.5;
    out.push({
      v: normalize([Math.cos(theta) * r, y, Math.sin(theta) * r]),
      // Radius is in 1-cos(angle) units: 0.02..0.07 is roughly a 11..21
      // degree cap. Sized deliberately small — wide caps overlap into a
      // smooth brightness wash that reads as a gradient, not as terrain.
      radius: 0.02 + wobble * 0.05,
      depth: 0.3 + wobble * 0.4,
    });
  }
  return out;
}

type Vec3 = [number, number, number];

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

export interface AsciiSphereOptions {
  cols: number;
  rows: number;
  /** Spin about the (tilted) polar axis, in radians. */
  spin: number;
  /** Axial tilt in radians — a head-on axis looks flatter and less planetary. */
  tilt?: number;
  /** 0..1 fill of the available grid. */
  scale?: number;
  /** Light floor on the unlit side; 0 makes the dark limb vanish into space. */
  ambient?: number;
}

/**
 * Rasterize one frame. Returns newline-separated rows of exactly `cols`
 * characters — render inside `.ascii-grid` so the rows line up.
 */
export function renderAsciiSphere({
  cols,
  rows,
  spin,
  tilt = 0.42,
  scale = 0.92,
  ambient = 0.06,
}: AsciiSphereOptions): string {
  const cells = new Array<string>(cols * rows).fill(" ");
  const depth = new Array<number>(cols * rows).fill(-Infinity);

  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  // Radius in row-units; x is stretched by CHAR_ASPECT when projected.
  const radius = Math.min(cols / (2 * CHAR_ASPECT), rows / 2) * scale;

  const sinSpin = Math.sin(spin);
  const cosSpin = Math.cos(spin);
  const sinTilt = Math.sin(tilt);
  const cosTilt = Math.cos(tilt);

  // Sample density scales with on-screen size so every cell gets covered
  // without wasting work on a small render.
  const thetaSteps = Math.max(64, Math.ceil(radius * 14));
  const phiSteps = Math.max(32, Math.ceil(radius * 7));

  for (let pi = 0; pi <= phiSteps; pi++) {
    const phi = (pi / phiSteps) * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    for (let ti = 0; ti < thetaSteps; ti++) {
      const theta = (ti / thetaSteps) * Math.PI * 2;

      // Object-space surface point (unit sphere, so this is also the normal).
      const ox = sinPhi * Math.cos(theta);
      const oy = cosPhi;
      const oz = sinPhi * Math.sin(theta);

      // Spin about Y, then tilt about X — the composition tilts the spin axis.
      const sx = ox * cosSpin + oz * sinSpin;
      const sz = -ox * sinSpin + oz * cosSpin;
      const wx = sx;
      const wy = oy * cosTilt - sz * sinTilt;
      const wz = oy * sinTilt + sz * cosTilt;

      // Back-facing points can never win the depth test; skip before lighting.
      if (wz <= 0) continue;

      const col = Math.round(cx + wx * radius * CHAR_ASPECT);
      const row = Math.round(cy + wy * radius);
      if (col < 0 || col >= cols || row < 0 || row >= rows) continue;

      const idx = row * cols + col;
      if (wz <= depth[idx]!) continue;

      let lum = wx * LIGHT[0] + wy * LIGHT[1] + wz * LIGHT[2];
      lum = Math.max(0, lum);

      // Craters darken in object space, so they rotate with the surface.
      // Skipped entirely on the unlit half: darkening zero stays zero, and
      // that's roughly half the sampled points at any given moment.
      if (lum > 0) {
        for (const crater of CRATERS) {
          const d = ox * crater.v[0] + oy * crater.v[1] + oz * crater.v[2];
          // Dot product near 1 means the sample sits inside the crater cap.
          const inside = 1 - d;
          if (inside < crater.radius) {
            const falloff = 1 - inside / crater.radius;
            lum *= 1 - crater.depth * falloff * falloff;
          }
        }
      }

      // Limb darkening: grazing angles at the edge fall off toward space.
      lum *= 0.35 + 0.65 * wz;
      lum = Math.min(1, ambient + lum);

      const level = Math.min(LUMA_RAMP.length - 1, Math.floor(lum * LUMA_RAMP.length));
      depth[idx] = wz;
      cells[idx] = LUMA_RAMP[level]!;
    }
  }

  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    lines.push(cells.slice(r * cols, r * cols + cols).join(""));
  }
  return lines.join("\n");
}
