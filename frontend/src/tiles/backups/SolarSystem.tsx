import { useEffect, useState } from 'react'
import { WireframeSphere } from './WireframeSphere'
import type { WorldSystem } from './useBackupWorlds'
import { FOCUS, FOCUS_TRANSITION } from './focusLayout'
import type { FocusTarget } from './focusLayout'

/* Motion here is deliberately off-token. The 1.56 overshoot spring, the entrance
   rise and the per-world float are decorative scene motion; --duration-fast and
   --duration-panel name UI roles (a hover, a panel opening) that a planet scene
   should not be flattened into. See agent_docs/HEALTH_CHECKLIST.md's Clean pillar
   — these are the documented one-offs, not near-misses of a token. */

const RENDER_SCALE = 2.5

const SUN_SIZE = 96
const WORLD_MIN = 40
const WORLD_MAX = 56

const KIND_COLOR: Record<string, string> = {
  overworld: '#22c55e',
  nether: '#ef4444',
  the_end: '#a78bfa',
}

function djb2(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) | 0
  return Math.abs(h)
}

// ─── Dimension dots ────────────────────────────────────────────────────────

interface DimDot {
  key: string
  color: string
  dx: number
  dy: number
  size: number
}

function buildDimDots(world: WorldSystem, renderSize: number): DimDot[] {
  return (world.dimensions ?? [])
    .filter((d) => d.kind !== 'overworld')
    .map((dim, di) => {
      const dh = djb2(`${world.name}/${dim.kind}`)
      const angle = (dh % 360) * (Math.PI / 180)
      const dist = renderSize * 0.6 + ((dh >> 4) % 8) * RENDER_SCALE
      return {
        key: `${world.name}/${dim.kind}`,
        color: KIND_COLOR[dim.kind] ?? '#60a5fa',
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist,
        size: (3 + (di % 2)) * RENDER_SCALE,
      }
    })
}

// ─── Per-world config ──────────────────────────────────────────────────────

interface WorldConfig {
  world: WorldSystem
  renderSize: number
  displaySize: number
  x: number // % left — scattered around sun
  y: number // % top  — scattered around sun
  floatIdx: number // which float animation (0-2)
  floatDelay: number // seconds offset so worlds bob out of phase
  dimDots: DimDot[]
  spinDuration: number
}

function buildConfigs(worlds: WorldSystem[]): WorldConfig[] {
  return worlds.map((world) => {
    const h = djb2(world.name)
    const h2 = djb2(world.name + '_x')

    const displaySize = WORLD_MIN + (h % (WORLD_MAX - WORLD_MIN + 1))
    const renderSize = Math.round(FOCUS.size * RENDER_SCALE)

    // Scatter around the sun (50%, 36%) using polar coords.
    // rx/ry are % of container so layout stays responsive.
    const angle = (h % 628) / 100 // 0..2π
    const rx = 16 + (h2 % 10) // 16-25% of width
    const ry = rx * 0.52 // flattened vertically
    const x = Math.max(12, Math.min(88, 50 + Math.cos(angle) * rx))
    const y = Math.max(8, Math.min(56, 36 + Math.sin(angle) * ry))

    return {
      world,
      renderSize,
      displaySize,
      x,
      y,
      floatIdx: h % 3,
      floatDelay: -((h >> 4) % 5),
      dimDots: buildDimDots(world, renderSize),
      spinDuration: 14 + (h % 10),
    }
  })
}

// ─── World node ────────────────────────────────────────────────────────────

function WorldNode({
  cfg,
  isFocused,
  isFaded,
  onClick,
}: {
  cfg: WorldConfig
  isFocused: boolean
  isFaded: boolean
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const scaleBase = cfg.displaySize / cfg.renderSize
  const scaleFocused = FOCUS.size / cfg.renderSize
  const currentScale = isFocused ? scaleFocused : hovered && !isFaded ? scaleBase * 1.06 : scaleBase

  return (
    <div
      className={`pointer-events-none absolute ${isFocused ? 'z-[5]' : 'z-[1]'} ${isFaded ? 'opacity-35' : 'opacity-100'}`}
      // eslint-disable-next-line no-restricted-syntax -- left/top mix a shared focused-position constant with a per-world computed scatter position; transition mixes multiple property/duration/easing pairs
      style={{
        left: isFocused ? FOCUS.left : `${cfg.x}%`,
        top: isFocused ? FOCUS.top : `${cfg.y}%`,
        transform: 'translate(-50%, -50%)',
        transition: FOCUS_TRANSITION,
      }}
    >
      {/* Entrance rise */}
      <div
        className={entered ? 'translate-y-0 opacity-100' : 'translate-y-[28px] opacity-0'}
        // eslint-disable-next-line no-restricted-syntax -- transition mixes multiple property/duration/easing pairs, not expressible as one Tailwind utility
        style={{
          transition: entered
            ? 'transform 420ms cubic-bezier(0.34,1.56,0.64,1), opacity 320ms ease'
            : 'none',
        }}
      >
        {/* Soft float — paused while focused */}
        <div
          className="backup-planet"
          // eslint-disable-next-line no-restricted-syntax -- float animation keyed by per-world floatIdx/floatDelay
          style={{
            animation: isFocused
              ? 'none'
              : `planet-float-${cfg.floatIdx} ${3 + cfg.floatIdx}s ${cfg.floatDelay}s ease-in-out infinite alternate`,
          }}
        >
          <div
            className="pointer-events-auto relative origin-center cursor-pointer transition-transform duration-[350ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] will-change-transform"
            // eslint-disable-next-line no-restricted-syntax -- renderSize/currentScale are computed per-world, invisible to Tailwind's static scanner
            style={{
              width: cfg.renderSize,
              height: cfg.renderSize,
              transform: `scale(${currentScale})`,
            }}
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            title={cfg.world.name}
          >
            <WireframeSphere
              size={cfg.renderSize}
              color={KIND_COLOR.overworld}
              spinDuration={cfg.spinDuration}
            />
            {cfg.dimDots.map((dot) => (
              <div
                key={dot.key}
                className="absolute rounded-full"
                // eslint-disable-next-line no-restricted-syntax -- position/size/color are computed per-dimension-dot, invisible to Tailwind's static scanner
                style={{
                  width: dot.size,
                  height: dot.size,
                  left: cfg.renderSize / 2 + dot.dx - dot.size / 2,
                  top: cfg.renderSize / 2 + dot.dy - dot.size / 2,
                  background: dot.color,
                  boxShadow: `0 0 ${dot.size * 2}px ${dot.color}99`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Sun node ──────────────────────────────────────────────────────────────

function SunNode({
  isFocused,
  isAnyFocused,
  onClick,
}: {
  isFocused: boolean
  isAnyFocused: boolean
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [])
  const renderSize = Math.round(FOCUS.size * RENDER_SCALE)
  const scaleBase = SUN_SIZE / renderSize
  const scaleFocus = FOCUS.size / renderSize
  const currentScale = isFocused
    ? scaleFocus
    : hovered && !isAnyFocused
      ? scaleBase * 1.06
      : scaleBase

  return (
    <div
      className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 ${isFocused ? 'top-[48%] left-[30%] z-[6]' : 'top-[36%] left-1/2 z-[2]'} ${isAnyFocused && !isFocused ? 'opacity-35' : 'opacity-100'}`}
      // eslint-disable-next-line no-restricted-syntax -- transition mixes multiple property/duration/easing pairs, not expressible as one Tailwind utility
      style={{ transition: FOCUS_TRANSITION }}
    >
      {/* Entrance rise */}
      <div
        className={entered ? 'translate-y-0 opacity-100' : 'translate-y-[28px] opacity-0'}
        // eslint-disable-next-line no-restricted-syntax -- transition mixes multiple property/duration/easing pairs, not expressible as one Tailwind utility
        style={{
          transition: entered
            ? 'transform 420ms cubic-bezier(0.34,1.56,0.64,1), opacity 320ms ease'
            : 'none',
        }}
      >
        <div
          className="pointer-events-auto origin-center cursor-pointer transition-transform duration-[350ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] will-change-transform"
          // eslint-disable-next-line no-restricted-syntax -- renderSize/currentScale are computed, invisible to Tailwind's static scanner
          style={{
            width: renderSize,
            height: renderSize,
            transform: `scale(${currentScale})`,
          }}
          onClick={onClick}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          title="Server"
        >
          <WireframeSphere size={renderSize} />
        </div>
      </div>
    </div>
  )
}

// ─── Solar system ──────────────────────────────────────────────────────────

export interface SolarSystemProps {
  worlds: WorldSystem[]
  focus: FocusTarget
  onWorldClick: (world: WorldSystem) => void
  onServerClick: () => void
}

export function SolarSystem({ worlds, focus, onWorldClick, onServerClick }: SolarSystemProps) {
  const configs = buildConfigs(worlds)

  const isServerFocused = focus?.kind === 'server'
  const isAnyFocused = focus !== null

  return (
    <div className="pointer-events-none absolute inset-0">
      <SunNode isFocused={isServerFocused} isAnyFocused={isAnyFocused} onClick={onServerClick} />
      {configs.map((cfg) => {
        const isFocused = focus?.kind === 'world' && focus.world.name === cfg.world.name
        const isFaded = isAnyFocused && !isFocused
        return (
          <WorldNode
            key={cfg.world.name}
            cfg={cfg}
            isFocused={isFocused}
            isFaded={isFaded}
            onClick={() => onWorldClick(cfg.world)}
          />
        )
      })}
    </div>
  )
}
