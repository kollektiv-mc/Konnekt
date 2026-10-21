import { useEffect, useState } from 'react'
import {
  cubeView,
  FACE,
  GAP,
  NODE_R,
  ORBIT,
  orbitPath,
  orbitPoint,
  RESTING_FRAME,
  SPLASH_MS,
  splashFrame,
  STROKE,
} from '../lib/splashMark'

// jsdom has no matchMedia, hence the optional call.
const prefersStill = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/*
 * The mark builds itself: the block spins in and the node flies one lap,
 * drawing the orbit, and comes to rest where the static mark has it. Then the
 * overlay fades (style.css) and this unmounts.
 *
 * The gaps are the canvas colour rather than a mask, which is equivalent on a
 * solid overlay and lets them follow the block as it turns. The block's gap
 * outline sits under its own base fill, never directly under the faces, or
 * the faces' edges would antialias against it into a dark seam.
 */
export function SplashScreen() {
  const [still] = useState(prefersStill)
  const [ms, setMs] = useState(0)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const end = setTimeout(() => setDone(true), still ? SPLASH_MS.still : SPLASH_MS.total)
    if (still || typeof requestAnimationFrame !== 'function') return () => clearTimeout(end)
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const elapsed = now - t0
      setMs(elapsed)
      if (elapsed < SPLASH_MS.fadeStart) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      clearTimeout(end)
      cancelAnimationFrame(raf)
    }
  }, [still])

  if (done) return null

  const frame = still ? RESTING_FRAME : splashFrame(ms)
  const cube = cubeView(frame.azimuth, frame.drop)
  const orbit = orbitPath(frame.orbitFrom, frame.nodeT)
  const [nx, ny] = orbitPoint(frame.nodeT)
  const nodeInFront = ny >= ORBIT.cy
  const node =
    frame.nodeScale > 0 ? (
      <g transform={`translate(${nx} ${ny}) scale(${frame.nodeScale})`}>
        <circle r={NODE_R + GAP} className="fill-canvas" />
        <circle r={NODE_R} fill={FACE.top} />
      </g>
    ) : null
  const pts = (p: readonly (readonly [number, number])[]) => p.map((q) => q.join(',')).join(' ')

  return (
    <div className={still ? 'splash-overlay splash-still' : 'splash-overlay'} aria-hidden="true">
      <svg className="splash-mark" viewBox="0 0 24 24" fill="none">
        <defs>
          {/* The front of the orbit. The ink reaches higher than the gap so
              where the gap's clip edge antialiases there is ink over it. */}
          <clipPath id="splash-front-gap">
            <rect x="-4" y={ORBIT.cy - 0.6} width="32" height="20" />
          </clipPath>
          <clipPath id="splash-front-ink">
            <rect x="-4" y={ORBIT.cy - 1.2} width="32" height="20" />
          </clipPath>
        </defs>
        <path d={orbit} stroke={FACE.top} strokeWidth={STROKE} />
        {nodeInFront ? null : node}
        <g opacity={frame.cubeOpacity}>
          <polygon
            points={pts(cube.hull)}
            className="fill-canvas stroke-canvas"
            strokeWidth={2 * GAP}
            strokeLinejoin="round"
          />
          <polygon points={pts(cube.hull)} fill={FACE.left} />
          {cube.faces.map((face, i) => (
            <polygon key={i} points={pts(face.points)} fill={face.fill} />
          ))}
        </g>
        <path
          d={orbit}
          className="stroke-canvas"
          strokeWidth={STROKE + 2 * GAP}
          clipPath="url(#splash-front-gap)"
        />
        <path d={orbit} stroke={FACE.top} strokeWidth={STROKE} clipPath="url(#splash-front-ink)" />
        {nodeInFront ? node : null}
      </svg>
    </div>
  )
}
