import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { OrbitRing } from './OrbitRing'
import { OrbitPath } from './OrbitPath'
import type { WorldSystem as WorldSystemData } from '../useWorlds'

const KIND_COLOR: Record<string, string> = {
  overworld: '#22c55e',
  nether: '#ef4444',
  the_end: '#a78bfa',
}

const KIND_LABEL: Record<string, string> = {
  nether: 'Nether',
  the_end: 'The End',
}

// Moon orbit params (local to the focused planet's group)
const MOON_ORBIT: Record<
  string,
  { orbitRX: number; orbitRZ: number; speed: number; offset: number }
> = {
  nether: { orbitRX: 2.0, orbitRZ: 1.1, speed: 0.06, offset: 0 },
  the_end: { orbitRX: 3.2, orbitRZ: 1.8, speed: 0.04, offset: Math.PI * 0.6 },
}

// ----- MoonBody: orbits the parent group (the planet), scales with zoomProgress -----

interface MoonBodyProps {
  kind: string
  radius: number
  orbitRX: number
  orbitRZ: number
  speed: number
  offset: number
  selected: boolean
  onSelect: () => void
  planetFocused: boolean
  worldName?: string
  positionsRef?: React.MutableRefObject<Map<string, THREE.Vector3>>
}

function MoonBody({
  kind,
  radius,
  orbitRX,
  orbitRZ,
  speed,
  offset,
  selected,
  onSelect,
  planetFocused,
  worldName,
  positionsRef,
}: MoonBodyProps) {
  const groupRef = useRef<THREE.Group>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  const labelGroupRef = useRef<THREE.Group>(null)
  const labelSpanRef = useRef<HTMLSpanElement>(null)
  const angleRef = useRef(offset)
  const worldPosRef = useRef(new THREE.Vector3())
  const hoverScaleRef = useRef(1)
  // Normalized direction from moon center to label; damped each frame (lerp+normalize ≈ slerp)
  const labelDirRef = useRef(new THREE.Vector3())
  const targetDirRef = useRef(new THREE.Vector3())
  const labelOffsetRef = useRef(0.32) // damped offset distance from moon surface
  const [hovered, setHovered] = useState(false)

  const color = KIND_COLOR[kind] ?? '#60a5fa'
  const label = KIND_LABEL[kind] ?? kind

  useFrame((state, delta) => {
    angleRef.current += speed * delta
    const x = Math.cos(angleRef.current) * orbitRX
    const z = Math.sin(angleRef.current) * orbitRZ
    if (groupRef.current) {
      groupRef.current.position.set(x, 0, z)
      if (positionsRef && worldName) {
        groupRef.current.getWorldPosition(worldPosRef.current)
        positionsRef.current.set(`${worldName}/${kind}`, worldPosRef.current)
      }
    }
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.3
      hoverScaleRef.current = THREE.MathUtils.damp(
        hoverScaleRef.current,
        hovered ? 1.06 : 1,
        10,
        delta,
      )
      meshRef.current.scale.setScalar(hoverScaleRef.current)
    }

    // Animate label direction: locked to the camera's screen-up when selected
    // (top of the moon from camera perspective), radially outward otherwise.
    // Lerp+normalize approximates slerp and always takes the shorter arc.
    // All parent groups are translation-only, so world directions = local directions.
    if (labelGroupRef.current) {
      const outLen = Math.sqrt(x * x + z * z)
      if (outLen > 0.001) {
        if (selected) {
          // Column 1 of the camera's world matrix (column-major) is its screen-up axis.
          // Read from elements directly to avoid a @types/three version mismatch.
          const e = state.camera.matrixWorld.elements
          targetDirRef.current.set(e[4], e[5], e[6])
        } else {
          targetDirRef.current.set(x / outLen, 0, z / outLen)
        }
        // Initialize on first valid frame so there's no snap from origin
        if (labelDirRef.current.lengthSq() < 0.001) {
          labelDirRef.current.copy(targetDirRef.current)
        }
        labelDirRef.current.lerp(targetDirRef.current, 1 - Math.exp(-5 * delta))
        labelDirRef.current.normalize()
        const targetOffset = selected ? radius + 0.2 : radius + 0.32
        labelOffsetRef.current = THREE.MathUtils.damp(
          labelOffsetRef.current,
          targetOffset,
          5,
          delta,
        )
        const r = labelOffsetRef.current
        labelGroupRef.current.position.set(
          labelDirRef.current.x * r,
          labelDirRef.current.y * r,
          labelDirRef.current.z * r,
        )
      }
    }
    // Fade by cursor distance in the orbital plane
    if (labelSpanRef.current) {
      const ray = state.raycaster.ray
      const rt = Math.abs(ray.direction.y) < 0.0001 ? 0 : -ray.origin.y / ray.direction.y
      const cx = ray.origin.x + ray.direction.x * rt
      const cz = ray.origin.z + ray.direction.z * rt
      const cursorDist = Math.sqrt(
        (worldPosRef.current.x - cx) ** 2 + (worldPosRef.current.z - cz) ** 2,
      )
      const FADE_NEAR = 0.8
      const FADE_FAR = 3.0
      const MIN_OPA = 0.2
      const f = Math.max(0, Math.min(1, (cursorDist - FADE_NEAR) / (FADE_FAR - FADE_NEAR)))
      labelSpanRef.current.style.opacity = String(MIN_OPA + (1 - f) * (1 - MIN_OPA))
    }
  })

  return (
    <group ref={groupRef}>
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation()
          onSelect()
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[radius, 24, 24]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={hovered || selected ? 0.45 : 0.2}
          roughness={0.6}
          metalness={0.1}
        />
      </mesh>

      {planetFocused && (
        <group ref={labelGroupRef}>
          <Html center style={{ pointerEvents: 'none', userSelect: 'none' }} distanceFactor={10}>
            <span
              ref={labelSpanRef}
              style={{
                fontFamily: 'monospace',
                fontSize: selected ? 7 : 9,
                color,
                whiteSpace: 'nowrap',
                opacity: 0,
              }}
            >
              {label}
            </span>
          </Html>
        </group>
      )}
    </group>
  )
}

// ----- Planet: the main orbiting world body -----

interface Props {
  kind: string
  radius: number
  orbitRX: number
  orbitRZ: number
  orbitSpeed: number
  orbitOffset?: number
  active?: boolean
  label: string
  onClickWithPos?: (pos: THREE.Vector3) => void
  // unified-scene props (only set for galaxy planets, not for internal moon use)
  focused?: boolean
  worldName?: string
  positionsRef?: React.MutableRefObject<Map<string, THREE.Vector3>>
  world?: WorldSystemData
  selectedDimension?: string | null
  onSelectDimension?: (kind: string) => void
}

export function Planet({
  kind,
  radius,
  orbitRX,
  orbitRZ,
  orbitSpeed,
  orbitOffset = 0,
  active = false,
  label,
  onClickWithPos,
  focused = false,
  worldName,
  positionsRef,
  world,
  selectedDimension,
  onSelectDimension,
}: Props) {
  const groupRef = useRef<THREE.Group>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  const moonSystemRef = useRef<THREE.Group>(null)
  const labelGroupRef = useRef<THREE.Group>(null)
  const labelSpanRef = useRef<HTMLSpanElement>(null)
  const angleRef = useRef(orbitOffset)
  const pushRef = useRef({ x: 0, z: 0 })
  const worldPosRef = useRef(new THREE.Vector3())
  const hoverScaleRef = useRef(1)
  // Per-planet zoom progress — damps independently so moons scale in/out smoothly
  // whether we're zooming in, zooming out, or switching to another planet.
  const localZoomRef = useRef(0)
  const [hovered, setHovered] = useState(false)

  const color = KIND_COLOR[kind] ?? '#60a5fa'
  const moons = world ? world.dimensions.filter((d) => d.kind !== 'overworld') : []

  useFrame((state, delta) => {
    angleRef.current += orbitSpeed * delta

    const ox = Math.cos(angleRef.current) * orbitRX
    const oz = Math.sin(angleRef.current) * orbitRZ

    // Cursor position projected onto the orbital plane (y=0) — shared by push + label fade
    const ray = state.raycaster.ray
    const rt = Math.abs(ray.direction.y) < 0.0001 ? 0 : -ray.origin.y / ray.direction.y
    const cx = ray.origin.x + ray.direction.x * rt
    const cz = ray.origin.z + ray.direction.z * rt
    const dx = ox - cx
    const dz = oz - cz
    const cursorDist = Math.sqrt(dx * dx + dz * dz)

    // Cursor attraction push — disabled when focused (avoids jitter during follow)
    if (!focused) {
      const threshold = 2.8
      const strength = cursorDist < threshold ? (1 - cursorDist / threshold) * 0.1 : 0
      const safeD = Math.max(cursorDist, 0.01)
      pushRef.current.x += ((-dx / safeD) * strength - pushRef.current.x) * 0.04
      pushRef.current.z += ((-dz / safeD) * strength - pushRef.current.z) * 0.04
    } else {
      // Damp push back to zero when focused
      pushRef.current.x += (0 - pushRef.current.x) * 0.08
      pushRef.current.z += (0 - pushRef.current.z) * 0.08
    }

    const g = groupRef.current
    if (g) g.position.set(ox + pushRef.current.x, 0, oz + pushRef.current.z)

    // Write live world-space position for the camera controller to track
    if (positionsRef && worldName && g) {
      g.getWorldPosition(worldPosRef.current)
      positionsRef.current.set(worldName, worldPosRef.current)
    }

    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.25
      hoverScaleRef.current = THREE.MathUtils.damp(
        hoverScaleRef.current,
        hovered ? 1.05 : 1,
        10,
        delta,
      )
      meshRef.current.scale.setScalar(hoverScaleRef.current)
    }

    // Damp the local zoom progress toward 1 when focused, 0 when not.
    // Using a per-planet ref (not the shared camera zoomRef) ensures moons
    // scale back smoothly on deselect instead of hard-cutting to zero.
    localZoomRef.current = THREE.MathUtils.damp(localZoomRef.current, focused ? 1 : 0, 3.5, delta)
    if (moonSystemRef.current) {
      moonSystemRef.current.scale.setScalar(localZoomRef.current)
    }

    // Place the name label radially outward from the sun (away from origin).
    // In local space of this group the outward direction is normalize(ox, 0, oz).
    if (labelGroupRef.current) {
      const px = ox + pushRef.current.x
      const pz = oz + pushRef.current.z
      const len = Math.sqrt(px * px + pz * pz)
      if (len > 0.001) {
        const nx = px / len
        const nz = pz / len
        labelGroupRef.current.position.set(nx * (radius + 0.5), 0.1, nz * (radius + 0.5))
      }
    }
    // Fade label: full opacity near cursor, fades to MIN_OPA when far away
    if (labelSpanRef.current) {
      const FADE_NEAR = 2.5
      const FADE_FAR = 7.0
      const MIN_OPA = 0.4 // raised so label stays readable in galaxy view
      const f = Math.max(0, Math.min(1, (cursorDist - FADE_NEAR) / (FADE_FAR - FADE_NEAR)))
      labelSpanRef.current.style.opacity = String(MIN_OPA + (1 - f) * (1 - MIN_OPA))
    }
  })

  function handleClick(e: { stopPropagation: () => void }) {
    e.stopPropagation()
    if (focused && onSelectDimension) {
      // When already zoomed in, clicking the planet opens the overworld HUD
      onSelectDimension('overworld')
      return
    }
    if (!onClickWithPos || !groupRef.current) return
    const pos = new THREE.Vector3()
    groupRef.current.getWorldPosition(pos)
    onClickWithPos(pos)
  }

  const showZoomedGlow = focused || localZoomRef.current > 0.1

  return (
    <group ref={groupRef}>
      {/* Planet sphere */}
      <mesh
        ref={meshRef}
        onClick={handleClick}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[radius, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={hovered ? 0.4 : showZoomedGlow ? 0.25 : 0.15}
          roughness={0.6}
          metalness={0.1}
        />
      </mesh>

      {active && <OrbitRing radius={radius} />}

      {/* Name tag: orbits with the planet, always on the outward side (away from sun).
          Position updated imperatively each frame; opacity driven by cursor distance. */}
      {!focused && (
        <group ref={labelGroupRef}>
          <Html center style={{ pointerEvents: 'none', userSelect: 'none' }} distanceFactor={10}>
            <span
              ref={labelSpanRef}
              style={{
                fontFamily: 'monospace',
                fontSize: 9,
                color,
                whiteSpace: 'nowrap',
                opacity: 0,
              }}
            >
              {label}
            </span>
          </Html>
        </group>
      )}

      {/* Moon system — scaled 0→1 by zoom progress, orbiting around this planet */}
      <group ref={moonSystemRef}>
        {moons.map((moon) => {
          const orbit = MOON_ORBIT[moon.kind] ?? {
            orbitRX: 2.0,
            orbitRZ: 1.1,
            speed: 0.05,
            offset: 0,
          }
          return (
            <group key={moon.kind}>
              <OrbitPath radiusX={orbit.orbitRX} radiusZ={orbit.orbitRZ} opacity={0.1} />
              {world && (
                <MoonBody
                  kind={moon.kind}
                  radius={0.18}
                  orbitRX={orbit.orbitRX}
                  orbitRZ={orbit.orbitRZ}
                  speed={orbit.speed}
                  offset={orbit.offset}
                  selected={selectedDimension === moon.kind}
                  onSelect={() => onSelectDimension?.(moon.kind)}
                  planetFocused={focused}
                  worldName={worldName}
                  positionsRef={positionsRef}
                />
              )}
            </group>
          )
        })}
      </group>
    </group>
  )
}
