import { describe, it, expect, beforeEach } from 'vitest'
import { applySkin, BUILTIN_SKINS } from './theme'
import { STATUS_DEFAULTS } from '../styles/tokens'

const base = {
  theme: 'dark',
  skinId: 'default',
  accentColor: STATUS_DEFAULTS.dark.accent,
  successColor: STATUS_DEFAULTS.dark.success,
  warningColor: STATUS_DEFAULTS.dark.warning,
  dangerColor: STATUS_DEFAULTS.dark.danger,
  backgroundStyle: 'solid' as const,
}

const root = () => document.documentElement
const inline = (prop: string) => root().style.getPropertyValue(prop)

beforeEach(() => {
  root().removeAttribute('style')
  delete root().dataset.theme
})

describe('applySkin status colours', () => {
  // The regression this guards: writing all four unconditionally put an inline
  // style on :root, which outranks any stylesheet rule, so the light theme's
  // darker success/warning/danger in tokens.css never applied.
  it('leaves untouched colours to the stylesheet', () => {
    applySkin({ ...base, theme: 'light' })

    for (const role of ['accent', 'success', 'warning', 'danger']) {
      expect(inline(`--${role}-rgb`)).toBe('')
    }
  })

  it('writes a colour the user actually chose', () => {
    applySkin({ ...base, theme: 'light', successColor: '#10b981' })

    expect(inline('--success-rgb')).toBe('16 185 129')
    expect(inline('--danger-rgb')).toBe('')
  })

  it('clears a previous override when the user resets to the default', () => {
    applySkin({ ...base, accentColor: '#3b82f6' })
    expect(inline('--accent-rgb')).toBe('59 130 246')

    applySkin(base)
    expect(inline('--accent-rgb')).toBe('')
  })
})

describe('applySkin theme and skin', () => {
  it('sets the theme attribute', () => {
    applySkin({ ...base, theme: 'light' })
    expect(root().dataset.theme).toBe('light')
  })

  // Generalised from a single-skin, single-token check. applySkin clears the
  // previous skin by remembering its *key set* (prevSkinTokenKeys), so the thing
  // worth guarding is that every key a skin writes is also cleared on the way
  // out — a property that only gets harder to hold as the maps grow.
  it.each(BUILTIN_SKINS)('applies and fully clears the $id skin', (skin) => {
    applySkin({ ...base, skinId: skin.id })
    for (const [key, value] of Object.entries(skin.tokens)) {
      expect(inline(key)).toBe(value)
    }

    applySkin({ ...base, skinId: 'default' })
    for (const key of Object.keys(skin.tokens)) {
      expect(inline(key)).toBe('')
    }
  })

  it('composes the gradient overlay from the accent channels', () => {
    applySkin({ ...base, backgroundStyle: 'gradient' })
    expect(inline('--bg-gradient-overlay')).toContain('var(--accent-rgb)')
  })
})

// These assert the shape of the skin table itself rather than applySkin's
// behaviour. Hand-editing five token maps is exactly where a typo like
// '--bg-suface' survives review: it costs nothing, does nothing, and is
// invisible until someone notices a surface that never rethemes.
describe('BUILTIN_SKINS', () => {
  const THEMEABLE_KEYS = [
    '--bg-base',
    '--bg-elevated',
    '--bg-overlay',
    '--bg-surface',
    '--hover-surface',
    '--border-subtle',
    '--border-hover',
    '--text-primary',
    '--text-secondary',
    '--text-muted',
    '--text-faint',
  ]

  it('has unique ids', () => {
    const ids = BUILTIN_SKINS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // Arity is already the tuple type's job; the format is not.
  it.each(BUILTIN_SKINS)('gives $id four six-digit preview hexes', (skin) => {
    for (const color of skin.previewColors) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it.each(BUILTIN_SKINS)('themes $id with real token names only', (skin) => {
    for (const key of Object.keys(skin.tokens)) {
      expect(THEMEABLE_KEYS).toContain(key)
    }
  })

  // A skin that moves the canvas but leaves the floating surfaces alone is how
  // Nord ended up with a blue-black popover punched into a slate-grey UI. If a
  // skin owns --bg-base it owns what sits on top of it too.
  it.each(BUILTIN_SKINS)('gives $id elevated and overlay surfaces if it sets a canvas', (skin) => {
    if (!skin.tokens['--bg-base']) return
    expect(skin.tokens['--bg-elevated']).toBeDefined()
    expect(skin.tokens['--bg-overlay']).toBeDefined()
  })
})
