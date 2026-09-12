import { useCallback, useState } from 'react'
import type { RefCallback } from 'react'

export interface ElementSize {
  width: number
  height: number
}

/**
 * The content box of an element, kept current as it resizes.
 *
 * A callback ref rather than a ref object plus an effect, so the observer
 * attaches the moment the element mounts and detaches when it goes, with no
 * dependency array to get wrong. Null until the first measurement, and null
 * for good where `ResizeObserver` does not exist (jsdom), so a caller has to
 * say what it does without a size rather than read zeros as a real box.
 */
export function useElementSize(): [RefCallback<HTMLElement>, ElementSize | null] {
  const [size, setSize] = useState<ElementSize | null>(null)
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, size]
}
