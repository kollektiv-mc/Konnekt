import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Reveals something only after the pointer has rested for `delay` ms, so a
 * pointer crossing a list on its way somewhere else never flashes it.
 *
 * `onEnter` fires immediately on mouse-enter — use it to start fetching, so
 * whatever appears at the end of the delay is already populated.
 */
export function useHoverDelay(delay = 1000, onEnter?: () => void) {
  const [hovered, setHovered] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const onMouseEnter = useCallback(() => {
    clear()
    onEnter?.()
    timer.current = setTimeout(() => setHovered(true), delay)
  }, [clear, delay, onEnter])

  const onMouseLeave = useCallback(() => {
    clear()
    setHovered(false)
  }, [clear])

  // The hovered element can vanish mid-hover (a config deleted, a list
  // re-rendered), which would otherwise leave the timer to fire into nothing.
  useEffect(() => clear, [clear])

  return { hovered, onMouseEnter, onMouseLeave }
}
