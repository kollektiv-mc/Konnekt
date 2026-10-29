import { useCallback, useState } from 'react'
import type { RefCallback } from 'react'

/** A wrapping grid as laid out: its column count, one row's pitch and the room it has. */
export interface GridBox {
  columns: number
  rowHeight: number
  gap: number
  height: number
}

/** How many cells a grid shows whole, with no scrolling. */
export function gridCapacity({ columns, rowHeight, gap, height }: GridBox): number {
  if (rowHeight <= 0) return 0
  const rows = Math.floor((height + gap) / (rowHeight + gap))
  return Math.max(0, columns) * Math.max(0, rows)
}

/**
 * The items a capacity shows and the count left out. When they do not all
 * fit, the last slot goes to the "+N more" cell, so it is never clipped
 * itself. A null capacity (nothing measured yet, or no ResizeObserver) shows
 * everything and lets the grid's overflow clip.
 */
export function fitItems<T>(items: readonly T[], capacity: number | null) {
  if (capacity === null || items.length <= capacity) return { shown: items, more: 0 }
  const shown = items.slice(0, Math.max(0, capacity - 1))
  return { shown, more: items.length - shown.length }
}

/**
 * How many cells of a CSS grid fit in its box, kept current as it resizes.
 *
 * Read from the grid as the browser laid it out (its resolved column track
 * list, the first cell's height, the row gap), so a cell's size lives in one
 * place, its classes, and a font-size setting that rescales them is followed
 * rather than fought. Every cell has to share one height for the count to be
 * right. `count` is how many items the grid holds; a change measures again,
 * since an empty grid has no cell to take a row height from.
 */
export function useGridFit(count: number): [RefCallback<HTMLElement>, number | null] {
  const [capacity, setCapacity] = useState<number | null>(null)
  const ref = useCallback(
    (el: HTMLElement | null) => {
      if (!el || count === 0 || typeof ResizeObserver === 'undefined') return
      const measure = () => {
        const style = getComputedStyle(el)
        const first = el.firstElementChild
        if (!first) return
        setCapacity(
          gridCapacity({
            columns: style.gridTemplateColumns.split(' ').filter(Boolean).length,
            rowHeight: first.getBoundingClientRect().height,
            gap: parseFloat(style.rowGap) || 0,
            height: el.clientHeight,
          }),
        )
      }
      measure()
      const observer = new ResizeObserver(measure)
      observer.observe(el)
      return () => observer.disconnect()
    },
    [count],
  )
  return [ref, capacity]
}
