import { useState, useRef, useEffect, useCallback, Suspense } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { CameraControls, Stars } from '@react-three/drei'
import * as THREE from 'three'
import { Galaxy } from './Galaxy'
import { WorldHud } from '../WorldHud'
import type { WorldSystem as WorldSystemData } from '../useWorlds'

interface Props {
  worlds: WorldSystemData[]
  onSetActive: (name: string) => Promise<void>
  onDelete: (name: string) => Promise<void>
  onRename: (old: string, next: string) => Promise<void>
  onDuplicate: (name: string, next: string) => Promise<void>
  onOpenFolder: (name: string) => Promise<void>
  onBackup: (name: string) => Promise<void>
  onRefresh: () => void
}

// Fixed scene-space offset from the focused planet (not sun-axis-relative)
const FOCUS_ELEV = 5.5 // units above the orbital plane
const FOCUS_BACK = 2.5 // units in +Z (gives slight frontal tilt; sun visible when planet is at +Z)
const FOCUS_DIST = Math.sqrt(FOCUS_ELEV * FOCUS_ELEV + FOCUS_BACK * FOCUS_BACK) // ≈ 4.92
const CLOSE_DIST_MOON = 1.2 // camera distance when a moon is the HUD focus
const CLOSE_DIST_PLANET = 2.5 // camera distance when the main planet is the HUD focus
const ZOOM_LAMBDA = 3.2
const CAM_LAMBDA = 4.5 // single time-constant for all camera transitions (tunable)

// Wheel-driven user zoom multiplier layered on top of the auto zoom-to-fit
// scale computed by Galaxy's LayoutScaleController.
const USER_ZOOM_MIN = 0.45
const USER_ZOOM_MAX = 2.5
const WHEEL_ZOOM_SENSITIVITY = 0.0012

// Precomputed unit direction: offset applied from the focused body to place the camera eye
const FOCUS_DIR = new THREE.Vector3(0, FOCUS_ELEV, FOCUS_BACK).normalize()

function SlowStars({ zoomRef }: { zoomRef: React.MutableRefObject<number> }) {
  const groupRef = useRef<THREE.Group>(null)
  const fadeUniform = useRef<{ value: number } | null>(null)
  const entranceRef = useRef(0) // ramps 0→1 on mount for star-only fade-in

  // Patch the Stars ShaderMaterial once it mounts so we can drive a uFade uniform.
  // drei's Stars uses AdditiveBlending + custom GLSL — material.opacity alone has no
  // effect; we must multiply alpha inside the fragment shader.
  useEffect(() => {
    if (!groupRef.current) return
    groupRef.current.traverse((obj) => {
      const points = obj as THREE.Points
      if (!points.isPoints) return
      const mat = points.material as THREE.ShaderMaterial
      if (fadeUniform.current) return // already patched
      // Mutate in-place so R3F's reconciler keeps managing the same material object.
      // Cloning and replacing points.material causes R3F to reset it back to the
      // original on the next re-render of Stars (via <primitive attach="material">).
      const fade = { value: 1.0 }
      mat.uniforms.uFade = fade
      // Vertex: add vShimmer varying — per-star phase from positional hash so each
      // star twinkles independently rather than all pulsing in sync.
      mat.vertexShader = mat.vertexShader
        .replace('varying vec3 vColor;', 'varying vec3 vColor;\nvarying float vShimmer;')
        .replace(
          'gl_Position = projectionMatrix * mvPosition;',
          // fract() keeps the hash in [0,1] so sin() never loses precision on large floats.
          // Per-star frequency (1.0–2.6) means stars drift out of phase over time instead
          // of all sharing the same period with just a phase offset.
          'float starPhase = fract(position.x * 1.27 + position.y * 3.11 + position.z * 0.74) * 6.2832;\n        float starFreq  = 1.0 + fract(position.z * 2.17 + position.x * 0.89) * 1.6;\n        vShimmer = sin(time * starFreq + starPhase);\n        gl_Position = projectionMatrix * mvPosition;',
        )
      mat.fragmentShader = mat.fragmentShader
        .replace(
          'uniform float fade;',
          'uniform float fade;\nuniform float uFade;\nvarying float vShimmer;',
        )
        .replace(
          'gl_FragColor = vec4(vColor, opacity);',
          'gl_FragColor = vec4(vColor * (0.82 + 0.18 * vShimmer), opacity * uFade);',
        )
      mat.needsUpdate = true
      fadeUniform.current = fade
    })
  }, [])

  useFrame((_, delta) => {
    if (!groupRef.current) return
    groupRef.current.rotation.y += delta * 0.001
    entranceRef.current = THREE.MathUtils.damp(entranceRef.current, 1, 8, delta)
    if (fadeUniform.current) {
      const zoomFade = Math.max(0, 1 - zoomRef.current / 0.4)
      fadeUniform.current.value = entranceRef.current * zoomFade
    }
  })

  return (
    <group ref={groupRef}>
      <Stars radius={60} depth={40} count={1400} factor={3} fade />
    </group>
  )
}

// Scales the scene content (planets, sun, controller) from 0.97→1 on reveal.
// Lives inside the Canvas so stars (outside this group) are unaffected.
function SceneScaleGroup({
  revealedRef,
  children,
}: {
  revealedRef: React.MutableRefObject<boolean>
  children: React.ReactNode
}) {
  const groupRef = useRef<THREE.Group>(null)
  const scaleRef = useRef(0.82)
  useFrame((_, delta) => {
    if (!groupRef.current || !revealedRef.current) return
    scaleRef.current = THREE.MathUtils.damp(scaleRef.current, 1, 10, delta)
    groupRef.current.scale.setScalar(scaleRef.current)
  })
  return (
    <group ref={groupRef} scale={0.82}>
      {children}
    </group>
  )
}

// Fires onReady after 2 rendered frames so the entrance reveal waits for actual
// WebGL content (shader compilation + first draw) rather than just canvas mount.
function FirstFrameSignal({ onReady }: { onReady: () => void }) {
  const frameCount = useRef(0)
  const fired = useRef(false)
  useFrame(() => {
    if (fired.current) return
    frameCount.current += 1
    if (frameCount.current >= 2) {
      fired.current = true
      onReady()
    }
  })
  return null
}

interface ControllerProps {
  focusNameRef: React.MutableRefObject<string | null>
  positionsRef: React.MutableRefObject<Map<string, THREE.Vector3>>
  zoomRef: React.MutableRefObject<number>
  camRef: React.RefObject<CameraControls | null>
  hudOpenRef: React.MutableRefObject<boolean>
  selectedDimensionRef: React.MutableRefObject<string | null>
  layoutScaleRef: React.MutableRefObject<number>
}

function SceneController({
  focusNameRef,
  positionsRef,
  zoomRef,
  camRef,
  hudOpenRef,
  selectedDimensionRef,
  layoutScaleRef,
}: ControllerProps) {
  const hudOffsetRef = useRef(0)
  // Live camera state — damped toward desiredEye/desiredTarget each frame
  const currentEye = useRef(new THREE.Vector3(0, 14, 5))
  const currentTarget = useRef(new THREE.Vector3(0, 0, 0))
  const desiredEye = useRef(new THREE.Vector3(0, 14, 5))
  const desiredTarget = useRef(new THREE.Vector3(0, 0, 0))

  useFrame((state, delta) => {
    // Keep zoomRef updated for SlowStars fade (0 = overview, 1 = focused)
    zoomRef.current = THREE.MathUtils.damp(
      zoomRef.current,
      focusNameRef.current ? 1 : 0,
      ZOOM_LAMBDA,
      delta,
    )

    // HUD offset drives the view-offset shift; kept independent of eye/target math
    const hudTarget = hudOpenRef.current ? 1 : 0
    hudOffsetRef.current = THREE.MathUtils.damp(hudOffsetRef.current, hudTarget, 4.5, delta)
    const t = hudOffsetRef.current

    // Compute desired eye + target from discrete logical state — no feedback loops
    const name = focusNameRef.current
    const dim = selectedDimensionRef.current
    const planetPos = name ? positionsRef.current.get(name) : undefined

    if (!name || !planetPos) {
      desiredEye.current.set(0, 14, 5)
      desiredTarget.current.set(0, 0, 0)
    } else {
      const isMoon = dim !== null && dim !== 'overworld'
      const moonPos = isMoon ? positionsRef.current.get(`${name}/${dim}`) : undefined
      const bodyPos = isMoon && moonPos ? moonPos : planetPos
      // Base distance scaled by the current zoom-to-fit layout scale so a focused
      // body frames correctly regardless of the overview zoom level it was
      // selected at (the body's own world position is already scaled — only the
      // camera offset needs compensating).
      const dist =
        (isMoon ? CLOSE_DIST_MOON : dim === 'overworld' ? CLOSE_DIST_PLANET : FOCUS_DIST) *
        layoutScaleRef.current

      desiredTarget.current.copy(bodyPos)
      desiredEye.current.copy(bodyPos).addScaledVector(FOCUS_DIR, dist)
    }

    // Single lambda damps actual camera toward desired — covers all transitions uniformly
    const k = 1 - Math.exp(-CAM_LAMBDA * delta)
    currentEye.current.lerp(desiredEye.current, k)
    currentTarget.current.lerp(desiredTarget.current, k)

    const cam = camRef.current
    if (cam) {
      cam.setLookAt(
        currentEye.current.x,
        currentEye.current.y,
        currentEye.current.z,
        currentTarget.current.x,
        currentTarget.current.y,
        currentTarget.current.z,
        false,
      )
    }

    // Shift focused body into right 2/3 when HUD panel is open
    // Formula (t = 0→1): fullW = W*(1 + t/3) → planet at (fullW/2)/W = 0.5 + t/6 → 0.667 at t=1
    const perspCam = state.camera as unknown as THREE.PerspectiveCamera
    if (t > 0.001) {
      const W = state.gl.domElement.width
      const H = state.gl.domElement.height
      perspCam.setViewOffset(W * (1 + t / 3), H, 0, 0, W, H)
    } else {
      perspCam.clearViewOffset()
    }
  })

  return null
}

export function WorldsScene({
  worlds,
  onSetActive,
  onDelete,
  onRename,
  onDuplicate,
  onOpenFolder,
  onBackup,
  onRefresh,
}: Props) {
  const [focusName, setFocusName] = useState<string | null>(null)
  const [selectedDimension, setSelectedDimension] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const revealedRef = useRef(false)
  const handleReady = useCallback(() => {
    setRevealed(true)
    revealedRef.current = true
  }, [])

  const focusNameRef = useRef<string | null>(null)
  const positionsRef = useRef(new Map<string, THREE.Vector3>())
  const zoomRef = useRef(0)
  const camRef = useRef<CameraControls>(null)
  const hudOpenRef = useRef(false)
  const selectedDimensionRef = useRef<string | null>(null)
  // Wheel-driven zoom multiplier (galaxy overview only) and the resulting
  // damped scale published by Galaxy's LayoutScaleController each frame —
  // see Galaxy.tsx for the zoom-to-fit implementation.
  const userZoomRef = useRef(1)
  const layoutScaleRef = useRef(1)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Keep refs in sync each render so SceneController reads the latest value each frame
  hudOpenRef.current = !!(focusName && selectedDimension)
  selectedDimensionRef.current = selectedDimension

  function selectWorld(name: string) {
    focusNameRef.current = name
    setFocusName(name)
    // Skip the intermediate planetary view for worlds with no other dimensions:
    // go straight to the overworld focus (HUD + close zoom), matching what a
    // second click would otherwise do. Worlds with orbiting dimensions still
    // enter planetary view so the user can pick a dimension.
    const world = worlds.find((w) => w.name === name)
    const hasOtherDimensions = !!world && world.dimensions.some((d) => d.kind !== 'overworld')
    setSelectedDimension(hasOtherDimensions ? null : 'overworld')
  }

  function goBack() {
    focusNameRef.current = null
    setFocusName(null)
    setSelectedDimension(null)
    userZoomRef.current = 1 // reset wheel zoom on return to the galaxy overview
  }

  // Non-passive wheel listener so we can preventDefault (mirrors BackupCarousel.tsx's
  // precedent). Ignored while a planet is focused — scrolling then either does nothing
  // (galaxy button visible) or hits the HUD panel's own overflowY:auto scroll, which
  // this must not fight.
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    function handleWheel(e: WheelEvent) {
      if (focusNameRef.current) return
      e.preventDefault()
      userZoomRef.current = THREE.MathUtils.clamp(
        userZoomRef.current * Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY),
        USER_ZOOM_MIN,
        USER_ZOOM_MAX,
      )
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [])

  const hudWorld = focusName ? (worlds.find((w) => w.name === focusName) ?? null) : null
  const hudOpen = !!(focusName && selectedDimension)

  const navBtn: React.CSSProperties = {
    background: 'transparent',
    border: '0.5px solid var(--border-subtle)',
    color: 'var(--text-muted)',
    borderRadius: 4,
    padding: '3px 10px',
    fontFamily: 'monospace',
    fontSize: 11,
    cursor: 'pointer',
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Entrance reveal — wrapper div so the WebGL drawing-buffer size (set by Canvas
          layout, already correct after the 220ms gate) is never affected by transform */}
      <div
        ref={wrapperRef}
        style={{
          position: 'absolute',
          inset: 0,
          opacity: revealed ? 1 : 0,
          transition: revealed ? 'opacity 0.4s cubic-bezier(0.25,0,0.25,1)' : 'none',
        }}
      >
        {/* ← galaxy button — only visible in planetary view when the HUD panel is closed */}
        {focusName && !hudOpen && (
          <button
            onClick={goBack}
            style={{ position: 'absolute', top: 10, left: 10, zIndex: 20, ...navBtn }}
          >
            ← galaxy
          </button>
        )}

        <Canvas
          camera={{ position: [0, 14, 5], fov: 50 }}
          style={{ position: 'absolute', inset: 0, background: '#050608' }}
        >
          <Suspense fallback={null}>
            <SlowStars zoomRef={zoomRef} />
            <FirstFrameSignal onReady={handleReady} />

            <SceneScaleGroup revealedRef={revealedRef}>
              <Galaxy
                worlds={worlds}
                focusName={focusName}
                positionsRef={positionsRef}
                selectedDimension={selectedDimension}
                onSelectWorld={selectWorld}
                onSelectDimension={(kind) =>
                  setSelectedDimension((k) => (k === kind ? null : kind))
                }
                focusNameRef={focusNameRef}
                userZoomRef={userZoomRef}
                layoutScaleRef={layoutScaleRef}
              />

              {/* SceneController last so all planet positions are written before it reads them */}
              <SceneController
                focusNameRef={focusNameRef}
                positionsRef={positionsRef}
                zoomRef={zoomRef}
                camRef={camRef}
                hudOpenRef={hudOpenRef}
                selectedDimensionRef={selectedDimensionRef}
                layoutScaleRef={layoutScaleRef}
              />
            </SceneScaleGroup>
          </Suspense>

          <CameraControls ref={camRef} enabled={false} />
        </Canvas>

        {/* HUD panel — outside Canvas so it receives pointer events normally.
          Slides in from the LEFT; camera simultaneously shifts the planet into the right 2/3
          via setViewOffset (planet at ≈66.7% from left = centre of the right two-thirds). */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: '33.3333%',
            background: 'var(--bg-surface)',
            borderRight: '0.5px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            padding: '16px 20px 24px',
            overflowY: 'auto',
            transform: hudOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 0.25s cubic-bezier(0.25, 0, 0.25, 1)',
            pointerEvents: hudOpen ? 'auto' : 'none',
            zIndex: 10,
          }}
        >
          {/* Navigation */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexShrink: 0 }}>
            <button style={navBtn} onClick={goBack}>
              ← galaxy
            </button>
            <button style={navBtn} onClick={() => setSelectedDimension(null)}>
              ← system
            </button>
          </div>

          {hudWorld && selectedDimension && (
            <WorldHud
              world={hudWorld}
              dimension={selectedDimension}
              onClose={() => setSelectedDimension(null)}
              onSetActive={onSetActive}
              onDelete={onDelete}
              onRename={onRename}
              onDuplicate={onDuplicate}
              onOpenFolder={onOpenFolder}
              onBackup={onBackup}
              onRefresh={onRefresh}
            />
          )}
        </div>
      </div>
    </div>
  )
}
