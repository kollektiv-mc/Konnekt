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

  it('applies skin token overrides and clears them on switch back', () => {
    const nord = BUILTIN_SKINS.find((s) => s.id === 'nord')!

    applySkin({ ...base, skinId: 'nord' })
    expect(inline('--bg-base')).toBe(nord.tokens['--bg-base'])

    applySkin({ ...base, skinId: 'default' })
    expect(inline('--bg-base')).toBe('')
  })

  it('composes the gradient overlay from the accent channels', () => {
    applySkin({ ...base, backgroundStyle: 'gradient' })
    // Pinned in full, not matched loosely: the overlay is deliberately kept
    // whisper-subtle, so the 0.07 alpha and the geometry are the decision. A
    // change here should be a change someone meant to make.
    expect(inline('--bg-gradient-overlay')).toBe(
      'radial-gradient(ellipse at top right, rgb(var(--accent-rgb) / 0.07) 0%, transparent 65%)',
    )
  })

  // Never covered before. This half of the setting was always correct; what was
  // broken is that neither half reached the screen, because the Dashboard canvas
  // painted an opaque --bg-base over the body that carries the overlay.
  it('clears the gradient overlay for the solid background style', () => {
    applySkin({ ...base, backgroundStyle: 'gradient' })
    applySkin({ ...base, backgroundStyle: 'solid' })
    expect(inline('--bg-gradient-overlay')).toBe('none')
  })
})
