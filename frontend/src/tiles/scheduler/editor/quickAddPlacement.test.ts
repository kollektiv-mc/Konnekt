import { describe, expect, it } from 'vitest'
import { placeQuickAdd } from './quickAddPlacement'

const panel = { w: 160, h: 100 }
const vp = { w: 1000, h: 600 }

describe('placeQuickAdd', () => {
  it('opens at the cursor with the fly-out to the right when there is room', () => {
    expect(placeQuickAdd({ x: 100, y: 50 }, panel, vp)).toEqual({
      primaryLeft: 100,
      primaryTop: 50,
      flyoutLeft: 260,
    })
  })

  it('flips left at the right edge', () => {
    const p = placeQuickAdd({ x: 950, y: 50 }, panel, vp)
    expect(p.primaryLeft).toBe(790)
    expect(p.flyoutLeft).toBe(630)
  })

  it('flips up at the bottom edge', () => {
    expect(placeQuickAdd({ x: 100, y: 580 }, panel, vp).primaryTop).toBe(480)
  })

  it('clamps at the left edge', () => {
    const p = placeQuickAdd({ x: -20, y: 50 }, panel, vp)
    expect(p.primaryLeft).toBe(0)
    expect(p.flyoutLeft).toBe(160)
  })

  it('clamps at the top edge', () => {
    expect(placeQuickAdd({ x: 100, y: -30 }, panel, vp).primaryTop).toBe(0)
  })

  it('clamps a flipped panel that would leave the left edge in a narrow window', () => {
    const p = placeQuickAdd({ x: 180, y: 50 }, panel, { w: 200, h: 600 })
    expect(p.primaryLeft).toBe(20)
    expect(p.flyoutLeft).toBe(0)
  })

  it('clamps a flipped-up panel that is taller than the room above the cursor', () => {
    expect(placeQuickAdd({ x: 100, y: 550 }, { w: 160, h: 580 }, vp).primaryTop).toBe(0)
  })

  it('switches the fly-out to the left when it would overflow the right edge', () => {
    const p = placeQuickAdd({ x: 600, y: 50 }, panel, { w: 900, h: 600 })
    expect(p.primaryLeft).toBe(600)
    expect(p.flyoutLeft).toBe(440)
  })

  it('rounds fractional cursor positions to whole pixels', () => {
    const p = placeQuickAdd({ x: 100.6, y: 50.4 }, panel, vp)
    expect(p.primaryLeft).toBe(101)
    expect(p.primaryTop).toBe(50)
  })

  it('uses the measured width, not a fixed one', () => {
    expect(placeQuickAdd({ x: 900, y: 0 }, { w: 200, h: 100 }, vp).primaryLeft).toBe(700)
  })
})
