import { describe, expect, it } from 'vitest'
import { placeFlyoutTop, placeGroupPanelLeft, placeQuickAdd } from './quickAddPlacement'

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

describe('placeFlyoutTop', () => {
  it('lines the fly-out up with a row near the top of the panel', () => {
    expect(placeFlyoutTop(50, 28, 120, 600)).toBe(78)
  })

  it('keeps the first row level with the panel when the offset is zero', () => {
    expect(placeFlyoutTop(50, 0, 120, 600)).toBe(50)
  })

  it('slides up when a lower row would push the fly-out past the bottom', () => {
    // Row at 500, fly-out 200 tall in a 600 window: its bottom must be 600.
    expect(placeFlyoutTop(400, 100, 200, 600)).toBe(400)
  })

  it('stays put when the fly-out fits exactly against the bottom', () => {
    expect(placeFlyoutTop(400, 80, 120, 600)).toBe(480)
  })

  it('pins to the top edge when taller than the window', () => {
    expect(placeFlyoutTop(100, 60, 700, 600)).toBe(0)
  })

  it('never goes above the window for a negative top', () => {
    expect(placeFlyoutTop(-40, 10, 100, 600)).toBe(0)
  })

  it('rounds a fractional row position to whole pixels', () => {
    expect(placeFlyoutTop(50.4, 27.3, 100, 600)).toBe(78)
  })

  it('leaves the side flip to placeQuickAdd, whatever the row', () => {
    const near = placeQuickAdd({ x: 950, y: 50 }, panel, vp)
    expect(near.flyoutLeft).toBe(630)
    expect(placeFlyoutTop(near.primaryTop, 90, 120, vp.h)).toBe(140)
  })
})

describe('placeGroupPanelLeft', () => {
  it('continues to the right of a right-hand fly-out', () => {
    expect(placeGroupPanelLeft(100, 260, 160, 1000)).toBe(420)
  })

  it('continues to the left of a flipped fly-out', () => {
    expect(placeGroupPanelLeft(790, 630, 160, 1000)).toBe(470)
  })

  it('takes the far side of the primary panel when the right is out of room', () => {
    // Fly-out at 600..760 in a 900 window: a third panel would end at 920.
    expect(placeGroupPanelLeft(440, 600, 160, 900)).toBe(280)
  })

  it('takes the far side of the primary panel when the left is out of room', () => {
    // Fly-out flipped to 0..160 with the primary at 160: nothing fits left of it.
    expect(placeGroupPanelLeft(160, 0, 160, 1000)).toBe(320)
  })

  it('stays inside the window in a window too narrow for any side', () => {
    expect(placeGroupPanelLeft(20, 0, 160, 200)).toBe(40)
  })
})
