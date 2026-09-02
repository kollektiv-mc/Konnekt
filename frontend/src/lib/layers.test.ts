import { describe, it, expect } from 'vitest'
import css from '../style.css?raw'
import { LAYER, declaredLayer } from './layers'
import type { Layer } from './layers'

// The scale exists twice on purpose: this module documents it and the tests
// resolve names through it, style.css declares it so Tailwind can compile the
// classes. Nothing generates one from the other, so this is the guard. `?raw`
// is Vite's untransformed read of the file, the same one the build compiles.

describe('layering scale', () => {
  it('is declared in style.css with the same names and values', () => {
    const declared = Object.fromEntries(
      [...css.matchAll(/--z-index-([a-z][a-z0-9-]*):\s*(\d+)\s*;/g)].map(([, name, value]) => [
        name,
        Number(value),
      ]),
    )
    expect(declared).toEqual(LAYER)
  })

  it('orders overlay < modal < dialog < popover < splash', () => {
    const order: Layer[] = ['overlay', 'modal', 'dialog', 'popover', 'splash']
    expect(Object.keys(LAYER)).toEqual(order)
    for (let i = 1; i < order.length; i++) {
      expect(LAYER[order[i]]).toBeGreaterThan(LAYER[order[i - 1]])
    }
  })

  it('leaves no literal z-index in the hand-authored CSS', () => {
    // .splash-overlay reads the splash layer; a bare number anywhere in the
    // file is a surface that has opted back out of the scale.
    expect(css).toMatch(/\.splash-overlay\s*\{[^}]*z-index:\s*var\(--z-index-splash\)/)
    expect(css.match(/z-index:\s*\d/g)).toBeNull()
  })

  it('resolves a declared layer off a class list and nothing else', () => {
    expect(declaredLayer('fixed inset-0 z-modal flex')).toBe('modal')
    expect(declaredLayer('z-50 fixed')).toBeNull()
    expect(declaredLayer('bg-overlay')).toBeNull()
  })
})
