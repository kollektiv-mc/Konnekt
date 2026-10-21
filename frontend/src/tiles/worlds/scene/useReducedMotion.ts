import { useSyncExternalStore } from 'react'
import { REDUCED_MOTION_QUERY, prefersReducedMotion } from './motion'

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia?.(REDUCED_MOTION_QUERY)
  mq?.addEventListener('change', onChange)
  return () => mq?.removeEventListener('change', onChange)
}

/** The OS reduced-motion preference, live: toggling it stops or resumes a tumble mid-session. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false)
}
