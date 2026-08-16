import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Sun } from './Sun'
import { Planet } from './Planet'
import { OrbitPath } from './OrbitPath'
import type { WorldSystem } from '../useWorlds'

interface Props {
  worlds: WorldSystem[]
  focusName: string | null
  positionsRef: React.MutableRefObject<Map<string, THREE.Vector3>>
  selectedDimension: string | null
  onSelectWorld: (name: string) => void
  onSelectDimension: (kind: string) => void
  // Zoom-to-fit inputs/outputs — see LayoutScaleController below
  focusNameRef: React.MutableRefObject<string | null>
  userZoomRef: React.MutableRefObject<number>
  layoutScaleRef: React.MutableRefObject<number>
}

function planetRadius(totalSize: number): number {
  const mb = totalSize / (1024 * 1024)
  return Math.max(0.26, Math.min(0.58, 0.26 + Math.log10(mb + 1) * 0.13))
}

// Fixed world-space spread for orbit radii. Must NOT depend on useThree().viewport
// because viewport.width changes when the camera zooms in — any re-render during
// the transition would recalculate smaller orbit radii and snap all planets.
const GALAXY_SPREAD = 11

// Zoom-to-fit tuning — see LayoutScaleController.
const FIT_MARGIN = 0.15 // fraction of the viewport kept as breathing room
const SCALE_MIN = 0.25
const SCALE_MAX = 1.6
const SCALE_LAMBDA = 6

// The four NDC viewport corners, unprojected onto the y=0 ground plane each
// frame to measure the actual visible world-space extent.
const NDC_CORNERS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
]

interface LayoutScaleControllerProps {
  groupRef: React.RefObject<THREE.Group | null>
  outerRX: number
  outerRZ: number
  focusNameRef: React.MutableRefObject<string | null>
  userZoomRef: React.MutableRefObject<number>
  layoutScaleRef: React.MutableRefObject<number>
}

// Scales the planet/orbit group (not the Sun) so the full orbit spread stays
// framed inside the viewport regardless of world count, layered with a
// wheel-driven user zoom multiplier (userZoomRef, owned by WorldsScene).
//
// Frozen while a planet is focused (focusNameRef set) so the follow camera
// in WorldsScene's SceneController never fights a rescale mid-flight — the
// last overview scale is held steady and published unchanged.
//
// Ground-plane projection reuses the same ray/plane technique as Planet.tsx's
// cursor tracking (t = -origin.y / direction.y, then origin + direction * t),
// applied to the four NDC viewport corners instead of the pointer, to derive
// the actual visible half-extents in world space.
function LayoutScaleController({
  groupRef,
  outerRX,
  outerRZ,
  focusNameRef,
  userZoomRef,
  layoutScaleRef,
}: LayoutScaleControllerProps) {
  const currentScale = useRef(1)
  const tmpPoint = useRef(new THREE.Vector3())
  const tmpOrigin = useRef(new THREE.Vector3())
  const tmpDir = useRef(new THREE.Vector3())

  useFrame((state, delta) => {
    const g = groupRef.current
    if (!g) return

    if (focusNameRef.current) {
      // Freeze at the last overview scale — no recompute while focused/flying.
      g.scale.setScalar(currentScale.current)
      layoutScaleRef.current = currentScale.current
      return
    }

    let target = currentScale.current
    if (outerRX > 0.0001 && outerRZ > 0.0001) {
      let minX = Infinity,
        maxX = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity
      for (const [nx, ny] of NDC_CORNERS) {
        tmpPoint.current.set(nx, ny, 0.5).unproject(state.camera as unknown as THREE.Camera)
        tmpOrigin.current.copy(state.camera.position)
        tmpDir.current.copy(tmpPoint.current).sub(tmpOrigin.current).normalize()
        if (Math.abs(tmpDir.current.y) < 0.0001) continue
        const t = -tmpOrigin.current.y / tmpDir.current.y
        if (t < 0) continue
        const px = tmpOrigin.current.x + tmpDir.current.x * t
        const pz = tmpOrigin.current.z + tmpDir.current.z * t
        minX = Math.min(minX, px)
        maxX = Math.max(maxX, px)
        minZ = Math.min(minZ, pz)
        maxZ = Math.max(maxZ, pz)
      }
      if (
        Number.isFinite(minX) &&
        Number.isFinite(maxX) &&
        Number.isFinite(minZ) &&
        Number.isFinite(maxZ)
      ) {
        const halfX = (maxX - minX) / 2
        const halfZ = (maxZ - minZ) / 2
        const fit = Math.min(halfX / outerRX, halfZ / outerRZ) * (1 - FIT_MARGIN)
        target = THREE.MathUtils.clamp(fit * userZoomRef.current, SCALE_MIN, SCALE_MAX)
      }
    }

    currentScale.current = THREE.MathUtils.damp(currentScale.current, target, SCALE_LAMBDA, delta)
    g.scale.setScalar(currentScale.current)
    layoutScaleRef.current = currentScale.current
  })

  return null
}

export function Galaxy({
  worlds,
  focusName,
  positionsRef,
  selectedDimension,
  onSelectWorld,
  onSelectDimension,
  focusNameRef,
  userZoomRef,
  layoutScaleRef,
}: Props) {
  const spread = GALAXY_SPREAD
  const step = worlds.length > 1 ? spread / worlds.length : spread
  const speedBase = 0.035
  const speedDecay = 0.88
  const orbitGroupRef = useRef<THREE.Group>(null)

  // Outermost orbit's unit-scale extent (mirrors the per-planet formula below)
  // — what LayoutScaleController fits to the viewport. Zero when there are no
  // worlds, guarded inside the controller.
  const lastIndex = worlds.length - 1
  const outerRX = lastIndex >= 0 ? 1.8 + (lastIndex + 0.5) * step : 0
  const outerRZ = outerRX * 0.55

  return (
    <group>
      {/* Increased distance so far planets stay lit when zoomed in */}
      <pointLight position={[0, 0, 0]} intensity={2} color="#fde68a" decay={0} />
      <ambientLight intensity={0.06} />

      <Sun radius={0.55} />

      {/* Planets/orbits only — scaled by LayoutScaleController so the Sun stays a fixed size */}
      <group ref={orbitGroupRef}>
        {worlds.map((w, i) => {
          const orbitRX = 1.8 + (i + 0.5) * step
          const orbitRZ = orbitRX * 0.55
          const speed = speedBase * Math.pow(speedDecay, i)
          const offset = (i / Math.max(worlds.length, 1)) * Math.PI * 2
          const r = planetRadius(w.totalSize)
          const focused = focusName === w.name

          return (
            <group key={w.name}>
              <OrbitPath radiusX={orbitRX} radiusZ={orbitRZ} />
              <Planet
                kind="overworld"
                radius={r}
                orbitRX={orbitRX}
                orbitRZ={orbitRZ}
                orbitSpeed={speed}
                orbitOffset={offset}
                active={w.active}
                label={w.name}

                onClickWithPos={() => !focused && onSelectWorld(w.name)}
                // unified-scene props
                focused={focused}
                worldName={w.name}
                positionsRef={positionsRef}
                world={w}
                selectedDimension={focused ? selectedDimension : null}
                onSelectDimension={onSelectDimension}
              />
            </group>
          )
        })}
      </group>

      <LayoutScaleController
        groupRef={orbitGroupRef}
        outerRX={outerRX}
        outerRZ={outerRZ}
        focusNameRef={focusNameRef}
        userZoomRef={userZoomRef}
        layoutScaleRef={layoutScaleRef}
      />
    </group>
  )
}
