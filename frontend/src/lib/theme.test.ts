import { describe, it, expect, beforeEach } from 'vitest'
import { ACCENT_PRESETS, applySkin, BUILTIN_SKINS, resolveSkin, skinSupportsLight } from './theme'
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

/**
 * jsdom ships no `matchMedia`, so `theme: 'system'` threw here rather than
 * resolving — which is why no test had ever exercised that branch. The stub is
 * the smallest surface applySkin actually uses: a `matches` flag standing in for
 * the OS preference, plus the listener pair it registers and cleans up.
 */
function stubMatchMedia(prefersDark: boolean) {
  const listeners = new Set<() => void>()
  const mql = {
    matches: prefersDark,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }
  window.matchMedia = (() => mql) as unknown as typeof window.matchMedia
  // Flips the OS preference and notifies, the way a real change event would.
  return (nowPrefersDark: boolean) => {
    mql.matches = nowPrefersDark
    for (const fn of listeners) fn()
  }
}

beforeEach(() => {
  root().removeAttribute('style')
  delete root().dataset.theme
  stubMatchMedia(false)
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

// A skin writes its tokens as inline custom properties on <html>, which outrank
// [data-theme='light']'s rules for the same properties. So a dark-only skin
// under the light theme keeps its dark surfaces while every token it does not
// override flips to a light value — Midnight, which overrides no text ramp,
// ended up painting near-black text on a near-black canvas. applySkin is the
// only place that sees every way that combination can arise, so it is where the
// combination is refused.
describe('applySkin light-mode clamp', () => {
  const darkOnly = BUILTIN_SKINS.filter((s) => !s.supportsLight)

  it('has exactly one skin solved against the light theme', () => {
    expect(BUILTIN_SKINS.filter((s) => s.supportsLight).map((s) => s.id)).toEqual(['default'])
  })

  it('keeps light mode for the default skin', () => {
    applySkin({ ...base, theme: 'light', skinId: 'default' })
    expect(root().dataset.theme).toBe('light')
  })

  // Settings refuses to store this pairing, so reaching it means a hand-edited
  // settings file — or one written by a build that predates the flag.
  it.each(darkOnly)('renders $id dark even when light is stored', (skin) => {
    applySkin({ ...base, theme: 'light', skinId: skin.id })
    expect(root().dataset.theme).toBe('dark')
  })

  // jsdom's matchMedia reports matches: false for '(prefers-color-scheme: dark)',
  // i.e. a light OS — the case no stored value can guard, because the user never
  // chose light here at all.
  it.each(darkOnly)('renders $id dark under system on a light OS', (skin) => {
    applySkin({ ...base, theme: 'system', skinId: skin.id })
    expect(root().dataset.theme).toBe('dark')
  })

  it('follows a light OS again as soon as the skin allows it', () => {
    applySkin({ ...base, theme: 'system', skinId: 'midnight' })
    expect(root().dataset.theme).toBe('dark')

    applySkin({ ...base, theme: 'system', skinId: 'default' })
    expect(root().dataset.theme).toBe('light')
  })

  // The clamp has to live inside the change listener too, not only in the first
  // resolve: a dark-only skin must survive the OS flipping under it.
  it('holds a dark-only skin dark across a live OS change', () => {
    const setPrefersDark = stubMatchMedia(false)
    applySkin({ ...base, theme: 'system', skinId: 'midnight' })
    expect(root().dataset.theme).toBe('dark')

    setPrefersDark(true)
    expect(root().dataset.theme).toBe('dark')

    setPrefersDark(false)
    expect(root().dataset.theme).toBe('dark')
  })

  it('still tracks a live OS change for a skin that supports light', () => {
    const setPrefersDark = stubMatchMedia(false)
    applySkin({ ...base, theme: 'system', skinId: 'default' })
    expect(root().dataset.theme).toBe('light')

    setPrefersDark(true)
    expect(root().dataset.theme).toBe('dark')
  })

  it('never clamps dark, which every skin supports', () => {
    for (const skin of BUILTIN_SKINS) {
      applySkin({ ...base, theme: 'dark', skinId: skin.id })
      expect(root().dataset.theme).toBe('dark')
    }
  })
})

describe('resolveSkin', () => {
  it('falls back to the default skin for an unknown id', () => {
    expect(resolveSkin('no-such-skin').id).toBe('default')
    expect(skinSupportsLight('no-such-skin')).toBe(true)
  })

  it('answers from the skin table rather than from the id', () => {
    expect(skinSupportsLight('default')).toBe(true)
    expect(skinSupportsLight('midnight')).toBe(false)
  })
})

// Each skin is designed around a hue, so picking one carries its accent. Two
// things have to hold for that to look deliberate rather than arbitrary.
describe('skin accent pairing', () => {
  const PAIRS: Record<string, string> = {
    default: 'Green',
    midnight: 'Violet',
    nord: 'Blue',
    solarized: 'Rose',
    mocha: 'Amber',
    forest: 'Green',
  }

  it('pairs every skin, with none left to inherit whatever came before', () => {
    expect(Object.keys(PAIRS).sort()).toEqual(BUILTIN_SKINS.map((s) => s.id).sort())
    for (const skin of BUILTIN_SKINS) expect(skin.accent).toBeTruthy()
  })

  // The one that matters for the UI: an accent that is not a preset would leave
  // every swatch unselected and light up ColorField's custom "+" slot instead,
  // so the gallery and the picker would disagree about what is active.
  it.each(BUILTIN_SKINS)('gives $id an accent the picker already offers', (skin) => {
    const hexes = ACCENT_PRESETS.map((p) => p.hex.toLowerCase())
    expect(hexes).toContain(skin.accent.toLowerCase())
  })

  it.each(BUILTIN_SKINS)('gives $id the intended preset', (skin) => {
    const preset = ACCENT_PRESETS.find((p) => p.hex === skin.accent)
    expect(preset?.label).toBe(PAIRS[skin.id])
  })

  // Green is the generated token default, so applySkin removes the inline
  // override for it rather than writing one. Worth stating: it means the two
  // green skins resolve their accent through tokens.css like an untouched
  // install, and the four others write a channel triplet.
  it('writes an inline accent for a skin whose accent is not the token default', () => {
    applySkin({ ...base, skinId: 'midnight', accentColor: resolveSkin('midnight').accent })
    expect(inline('--accent-rgb')).toBe('139 92 246')

    applySkin({ ...base, skinId: 'forest', accentColor: resolveSkin('forest').accent })
    expect(inline('--accent-rgb')).toBe('')
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
