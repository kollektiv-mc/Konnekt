import { useEffect, type RefObject } from 'react'

// The radius of the gradient in scheduler.css (`.node-glow-halo`). A node whose
// box is further than this from the cursor is entirely outside the light, so it is
// skipped rather than repainted.
export const GLOW_REACH_PX = 220

const IDLE_ATTR = 'data-glow-idle'

export type GlowPoint = { x: number; y: number }

/**
 * A screen point in a node's own coordinates, undoing React Flow's viewport zoom.
 *
 * The node sits inside a scaled viewport, so its bounding rect is in screen px
 * while the CSS the gradient is drawn in is in the node's unscaled px. The ratio
 * of the two widths is the zoom, read off the node itself so nothing here has to
 * know the viewport's transform. Rotation is not a concern: the viewport only
 * translates and scales.
 */
export function toNodeLocal(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width'>,
  offsetWidth: number,
): GlowPoint {
  const scale = offsetWidth > 0 && rect.width > 0 ? rect.width / offsetWidth : 1
  return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale }
}

/** Whether a node-local point is within `reach` of a width x height box. */
export function withinGlowReach(
  p: GlowPoint,
  width: number,
  height: number,
  reach: number = GLOW_REACH_PX,
): boolean {
  return p.x > -reach && p.x < width + reach && p.y > -reach && p.y < height + reach
}

/**
 * Feeds `--mx`/`--my` to every node under `wrapperRef`, for the halo in
 * scheduler.css. One `pointermove` listener on the canvas, coalesced to one
 * write per animation frame, rather than a listener per node.
 *
 * Nodes move under a still cursor when the viewport pans or zooms, and no
 * pointermove follows, so the viewport's own style changes schedule a repaint
 * too. Mouse and pen only: a touch has no hover to follow and the light would
 * stick where it last landed.
 */
export function useNodeGlow(wrapperRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    let cursor: GlowPoint | null = null
    let frame = 0
    // The nodes holding a position, so one that falls out of reach is cleared
    // once instead of being rewritten on every frame it stays far away.
    const lit = new Set<HTMLElement>()

    const paint = () => {
      frame = 0
      if (!cursor) return
      const { x: cx, y: cy } = cursor
      const nodes = wrapper.querySelectorAll<HTMLElement>('.react-flow__node')
      // Every read before any write, so the writes do not force a layout per node.
      const measured = Array.from(nodes, (el) => {
        const local = toNodeLocal(cx, cy, el.getBoundingClientRect(), el.offsetWidth)
        return { el, local, near: withinGlowReach(local, el.offsetWidth, el.offsetHeight) }
      })
      for (const { el, local, near } of measured) {
        if (near) {
          el.style.setProperty('--mx', `${Math.round(local.x)}px`)
          el.style.setProperty('--my', `${Math.round(local.y)}px`)
          lit.add(el)
        } else if (lit.delete(el)) {
          el.style.removeProperty('--mx')
          el.style.removeProperty('--my')
        }
      }
    }

    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(paint)
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return
      cursor = { x: e.clientX, y: e.clientY }
      wrapper.removeAttribute(IDLE_ATTR)
      schedule()
    }

    // The halo fades by CSS; the positions stay put so it fades out from where
    // the cursor was.
    const onLeave = () => wrapper.setAttribute(IDLE_ATTR, '')

    wrapper.addEventListener('pointermove', onMove, { passive: true })
    wrapper.addEventListener('pointerleave', onLeave)

    // The viewport element is React Flow's, with the pan and zoom in its style.
    const viewport = wrapper.querySelector('.react-flow__viewport')
    const observer = viewport
      ? new MutationObserver(() => {
          if (cursor) schedule()
        })
      : null
    if (viewport) observer?.observe(viewport, { attributes: true, attributeFilter: ['style'] })

    return () => {
      wrapper.removeEventListener('pointermove', onMove)
      wrapper.removeEventListener('pointerleave', onLeave)
      observer?.disconnect()
      if (frame !== 0) cancelAnimationFrame(frame)
      wrapper.removeAttribute(IDLE_ATTR)
      for (const el of lit) {
        el.style.removeProperty('--mx')
        el.style.removeProperty('--my')
      }
    }
  }, [wrapperRef])
}
