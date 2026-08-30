import { describe, it, expect, afterEach } from 'vitest'
import { applyScrollbarWidth, measureScrollbarWidth } from './scrollbar'

afterEach(() => {
  document.documentElement.style.removeProperty('--scrollbar-gutter')
})

describe('measureScrollbarWidth', () => {
  // jsdom lays nothing out, so offsetWidth and clientWidth are both 0 and the
  // difference is 0. That is the overlay-scrollbar answer, and the one the
  // guard has to produce rather than NaN.
  it('reports a usable number where nothing is laid out', () => {
    const width = measureScrollbarWidth()
    expect(Number.isFinite(width)).toBe(true)
    expect(width).toBeGreaterThanOrEqual(0)
  })

  // The probe is a real element in the document for the length of one layout
  // read. Leaving one behind per call would stack them up under the body.
  it('leaves no probe behind', () => {
    const before = document.body.childElementCount
    measureScrollbarWidth()
    measureScrollbarWidth()
    expect(document.body.childElementCount).toBe(before)
  })
})

describe('applyScrollbarWidth', () => {
  // `.scroll-overlay` reclaims exactly this much for its children, so the
  // property has to carry a unit — a bare number in calc() is invalid and the
  // declaration would be dropped, silently taking the reclaim with it.
  it('publishes the measurement as a px length', () => {
    applyScrollbarWidth()
    const value = document.documentElement.style.getPropertyValue('--scrollbar-gutter')
    expect(value).toMatch(/^\d+px$/)
  })
})
