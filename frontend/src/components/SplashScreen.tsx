import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
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
  splashClock,
  splashFrame,
  STROKE,
} from '../lib/splashMark'

// jsdom has no matchMedia, hence the optional call.
const prefersStill = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/*
 * The mark builds itself: the block spins in and the node flies one lap,
 * drawing the orbit, and comes to rest where the static mark has it. Then the
 * overlay fades (style.css), this unmounts and calls `onDone`. The timeline
 * runs on splashClock, which waits out the dashboard's mount before starting.
 *
 * Each frame is committed inside its own animation frame callback, with
 * flushSync. Left to React's scheduler it would be rendered in a task queued
 * behind whatever the dashboard has queued, and paint a frame late whenever
 * that work ran long.
 *
 * The gaps are the canvas colour rather than a mask, which is equivalent on a
 * solid overlay and lets them follow the block as it turns. The block's gap
 * outline sits under its own base fill, never directly under the faces, or
 * the faces' edges would antialias against it into a dark seam.
 */
export function SplashScreen({ onDone }: { onDone?: () => void }) {
  const [still] = useState(prefersStill)
  const [ms, setMs] = useState(0)
  const [fading, setFading] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const finish = () => {
      setDone(true)
      onDone?.()
    }
    if (still) {
      const end = setTimeout(finish, SPLASH_MS.still)
      return () => clearTimeout(end)
    }
    let raf = 0
    let end: ReturnType<typeof setTimeout> | undefined
    const clock = splashClock()
    const tick = (now: number) => {
      const elapsed = clock(now)
      if (elapsed >= SPLASH_MS.fadeStart) {
        setFading(true)
        end = setTimeout(finish, SPLASH_MS.fade)
        return
      }
      if (elapsed >= 0) flushSync(() => setMs(elapsed))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      clearTimeout(end)
      cancelAnimationFrame(raf)
    }
  }, [still, onDone])

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
  // A point pair stringifies as `x,y`, which is SVG's own points syntax.
  const pts = (p: readonly (readonly [number, number])[]) => p.join(' ')

  return (
    <div
      className={
        still
          ? 'splash-overlay splash-still'
          : fading
            ? 'splash-overlay splash-fading'
            : 'splash-overlay'
      }
      aria-hidden="true"
    >
      <svg className="splash-mark" viewBox="0 0 24 24" fill="none" strokeLinecap="round">
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
