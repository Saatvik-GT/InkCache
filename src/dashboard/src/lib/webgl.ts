/** Cheap, one-time capability check — avoids mounting a Canvas that would
    immediately fail on a browser/device with no WebGL. */
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")
    );
  } catch {
    return false;
  }
}
