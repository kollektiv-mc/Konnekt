import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { advanceTumble } from './motion'
import { useReducedMotion } from './useReducedMotion'

interface Props {
  /** Edge length in scene units. */
  size: number
  color: string
  /** Defaults to `color`, so a plain colour reads as a self-lit body. */
  emissive?: string
  emissiveIntensity?: number
}

// A resting pose off every axis, so a still cube (reduced motion, or the first frame) reads as a
// cube rather than a flat square.
const REST_ROTATION: [number, number, number] = [0.45, 0.6, 0]

/** A cube that slowly tumbles on two axes, and holds still under prefers-reduced-motion. */
export function SpinningCube({ size, color, emissive = color, emissiveIntensity = 1 }: Props) {
  const meshRef = useRef<THREE.Mesh>(null)
  const reduced = useReducedMotion()

  useFrame((_, delta) => {
    if (meshRef.current) advanceTumble(meshRef.current.rotation, delta, reduced)
  })

  return (
    <mesh ref={meshRef} rotation={REST_ROTATION}>
      <boxGeometry args={[size, size, size]} />
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
        roughness={0.8}
      />
    </mesh>
  )
}
