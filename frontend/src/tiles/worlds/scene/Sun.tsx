import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

interface Props {
  radius?: number
}

export function Sun({ radius = 0.55 }: Props) {
  const meshRef = useRef<THREE.Mesh>(null)

  const glowTexture = useMemo(() => {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const mid = size / 2
    const grad = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid)
    grad.addColorStop(0, 'rgba(255, 210, 60, 0.15)')
    grad.addColorStop(0.4, 'rgba(254, 190, 40, 0.06)')
    grad.addColorStop(1, 'rgba(253, 160, 20, 0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
    return new THREE.CanvasTexture(canvas)
  }, [])

  useFrame(({ clock }) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = clock.getElapsedTime() * 0.05
    }
  })

  return (
    <group>
      {/* Soft glow sprite — always faces camera, radial gradient fades to transparent */}
      <sprite scale={[radius * 4, radius * 4, 1]}>
        {/* @react-three/fiber's Texture prop type resolves against a different
            `three` type instance than our `THREE.Texture` (CanvasTexture is
            missing the legacy `encoding` field it expects) — a known r3f/three
            version-typing gap, not a real runtime concern. No clean cast bridges
            it, so the rule is suppressed for this one interop line. */}
        <spriteMaterial
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          // aislop-ignore-next-line ai-slop/unsafe-type-assertion -- the documented three/@react-three/fiber type mismatch (HEALTH_CHECKLIST, Clean)
          map={glowTexture as any}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </sprite>
      {/* Sun sphere */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[radius, 32, 32]} />
        <meshStandardMaterial
          color="#ffd84d"
          emissive="#ffc200"
          emissiveIntensity={1.2}
          roughness={0.8}
        />
      </mesh>
    </group>
  )
}
