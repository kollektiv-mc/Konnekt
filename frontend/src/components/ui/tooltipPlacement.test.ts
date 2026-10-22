import { describe, it, expect } from 'vitest'
import { placeTooltip } from './tooltipPlacement'

const VIEWPORT = { w: 1000, h: 600 }
const TIP = { w: 200, h: 40 }
const GAP = 8

function row(left: number, top: number, w = 100, h = 20) {
  return { left, top, right: left + w, bottom: top + h }
}

describe('placeTooltip', () => {
  it('sits to the right of the anchor, centred on its row', () => {
    expect(placeTooltip(row(100, 200), TIP, VIEWPORT, GAP)).toEqual({ left: 208, top: 190 })
  })

  it('flips to the left when the right side runs off the window', () => {
    // right edge 950 + gap + 200 would end at 1158
    const { left } = placeTooltip(row(850, 200), TIP, VIEWPORT, GAP)
    expect(left).toBe(850 - GAP - TIP.w)
  })

  it('stays on the right when it just fits', () => {
    // 796 + 8 + 200 = 1004 is past the margin, 788 + 8 + 200 = 996 is exactly on it
    const { left } = placeTooltip(row(688, 200), TIP, VIEWPORT, GAP)
    expect(left).toBe(796)
  })

  it('clamps to the top and bottom of the window', () => {
    expect(placeTooltip(row(100, 0), TIP, VIEWPORT, GAP).top).toBe(4)
    expect(placeTooltip(row(100, 590, 100, 10), TIP, VIEWPORT, GAP).top).toBe(600 - 40 - 4)
  })

  it('clamps a flipped card to the left edge of a narrow window', () => {
    const { left } = placeTooltip(row(60, 200), { w: 200, h: 40 }, { w: 220, h: 600 }, GAP)
    expect(left).toBe(4)
  })

  it('lands on whole pixels', () => {
    const { left, top } = placeTooltip(row(100.4, 200.3, 100.2, 20.5), TIP, VIEWPORT, GAP)
    expect(Number.isInteger(left)).toBe(true)
    expect(Number.isInteger(top)).toBe(true)
  })
})
