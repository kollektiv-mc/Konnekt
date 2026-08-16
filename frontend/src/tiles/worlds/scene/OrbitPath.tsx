import { useMemo } from 'react'
import { Line } from '@react-three/drei'

interface Props {
  radiusX: number
  radiusZ: number
  opacity?: number
}

export function OrbitPath({ radiusX, radiusZ, opacity = 0.12 }: Props) {
  const points = useMemo<[number, number, number][]>(() => {
    const pts: [number, number, number][] = []
    const segments = 128
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2
      pts.push([Math.cos(a) * radiusX, 0, Math.sin(a) * radiusZ])
    }
    return pts
  }, [radiusX, radiusZ])

  return <Line points={points} color="white" transparent opacity={opacity} lineWidth={0.5} />
}
