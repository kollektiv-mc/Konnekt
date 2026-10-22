// Per-face emissive scale for a self-lit cube, in BoxGeometry's material order (+x, -x, +y, -y,
// +z, -z). Opposite faces differ and the set averages to 1, so the body keeps the brightness it
// had as one flat colour while the tumble turns a brighter face and a dimmer one past the camera.
// Same hue throughout: only the emissive intensity moves.
export const FACE_GLOW: readonly number[] = [1.1, 0.85, 1.2, 0.75, 0.95, 1.15]

/** The emissive intensity of each face, for a cube whose flat intensity would be `base`. */
export function faceIntensities(base: number, glow: readonly number[] = FACE_GLOW): number[] {
  return glow.map((scale) => base * scale)
}
