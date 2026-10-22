import type { WorldSystem } from './useBackupWorlds'

export const FOCUS = { left: '30%', top: '48%', size: 150 }
export const FOCUS_TRANSITION =
  'left 380ms cubic-bezier(0.34,1.15,0.64,1), top 380ms cubic-bezier(0.34,1.15,0.64,1), opacity 250ms ease'

/** On-screen width, in CSS px, the sphere linework should land at whatever scale it is shown at. */
export const SPHERE_STROKE_PX = 1.25

/**
 * The SVG stroke width that renders at `onScreenPx` once the sphere is shrunk by a CSS
 * `scale(scale)`. The spheres are drawn at FOCUS.size * RENDER_SCALE and scaled down, so a fixed
 * stroke is multiplied by the scale (1.5 * 0.26 is about 0.4px) and breaks into dashes.
 */
export function strokeForScale(scale: number, onScreenPx = SPHERE_STROKE_PX): number {
  return scale > 0 ? onScreenPx / scale : onScreenPx
}

export type FocusTarget = { kind: 'server' } | { kind: 'world'; world: WorldSystem } | null
