import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_FAMILY_LENGTH, applyFonts, cleanFamily, normalizeFonts, quoteFamily } from './fonts'

const root = () => document.documentElement
const prop = (role: string) => root().style.getPropertyValue(`--font-${role}`)
// jsdom re-serializes a stack (quote style, spacing after commas); the order of
// the families is what matters, so compare without either.
const stack = (role: string) => prop(role).replace(/\s+/g, '').replaceAll("'", '"')

// jsdom loads no stylesheet of ours, so the token stacks are declared here the
// way tokens.css declares them, including the two that fall back to
// var(--font-sans).
let sheet: HTMLStyleElement
beforeEach(() => {
  root().removeAttribute('style')
  sheet = document.createElement('style')
  sheet.textContent = `:root {
    --font-sans: 'Ranade', system-ui, sans-serif;
    --font-title: 'Excon', var(--font-sans);
    --font-mono: ui-monospace, monospace;
    --font-display: 'Satoshi', var(--font-sans);
  }`
  document.head.append(sheet)
})
afterEach(() => sheet.remove())

describe('quoteFamily', () => {
  it('always yields a quoted CSS string', () => {
    expect(quoteFamily('Inter')).toBe('"Inter"')
    expect(quoteFamily('Font-Awesome 6')).toBe('"Font-Awesome 6"')
  })

  it('escapes the quote and the backslash so a name cannot close the string', () => {
    expect(quoteFamily('Say "hi" \\ bye')).toBe('"Say \\"hi\\" \\\\ bye"')
    const hostile = 'x"; --accent-rgb: 0 0 0; y: "'
    expect(quoteFamily(hostile)).toBe('"x\\"; --accent-rgb: 0 0 0; y: \\""')
  })

  it('turns control characters, newlines included, into spaces', () => {
    expect(quoteFamily('A\nB\r\fC\u0000D')).toBe('"A B  C D"')
  })
})

describe('cleanFamily', () => {
  it('trims, and caps the length', () => {
    expect(cleanFamily('  Fira Code  ')).toBe('Fira Code')
    expect(cleanFamily('x'.repeat(MAX_FAMILY_LENGTH + 50))).toHaveLength(MAX_FAMILY_LENGTH)
    expect(cleanFamily(' \n\t ')).toBe('')
  })
})

describe('normalizeFonts', () => {
  it('keeps known roles with a non-empty string and drops everything else', () => {
    expect(
      normalizeFonts({
        sans: ' Inter ',
        title: '',
        display: 3,
        mono: 'Fira Code',
        serif: 'Georgia',
      }),
    ).toEqual({ sans: 'Inter', mono: 'Fira Code' })
  })

  it('reads null and non-objects as no choice', () => {
    expect(normalizeFonts(null)).toEqual({})
    expect(normalizeFonts(undefined)).toEqual({})
    expect(normalizeFonts('Inter')).toEqual({})
  })
})

describe('applyFonts', () => {
  it('writes a chosen family in front of the token stack', () => {
    applyFonts({ mono: 'Fira Code' })
    expect(stack('mono')).toBe('"FiraCode",ui-monospace,monospace')
  })

  it('leaves an unchosen role alone and clears one that is no longer chosen', () => {
    root().style.setProperty('--font-title', '"Leftover"')
    applyFonts({ sans: 'Inter' })
    expect(prop('title')).toBe('')
    expect(prop('display')).toBe('')
    applyFonts({})
    expect(prop('sans')).toBe('')
  })

  it('treats an empty or blank name as the default', () => {
    applyFonts({ sans: 'Inter' })
    applyFonts({ sans: '   ' })
    expect(prop('sans')).toBe('')
  })

  // title and display fall back to var(--font-sans). A browser substitutes the
  // reference when the default is read back, jsdom leaves it as written; either
  // way the family ends up in front of the token's own stack, and the chosen
  // body face is reached through sans, which is why sans is applied first.
  it('puts the family in front of the token stack when the default falls back to sans', () => {
    applyFonts({ title: 'Cooper Black', sans: 'Inter' })
    expect(stack('sans')).toBe('"Inter","Ranade",system-ui,sans-serif')
    expect(stack('title')).toMatch(/^"CooperBlack","Excon",/)
  })

  it('does not rebuild a choice that is already in place', () => {
    applyFonts({ sans: 'Inter' })
    const before = root().getAttribute('style')
    root().style.setProperty('--probe', '1')
    applyFonts({ sans: 'Inter' })
    // A rebuild would have cleared and re-set the four font properties, which
    // moves them after --probe in the serialized declaration order.
    expect(root().getAttribute('style')).toBe(`${before}; --probe: 1;`.replace(/;;/g, ';'))
  })

  it('rebuilds when something else reset the element', () => {
    applyFonts({ sans: 'Inter' })
    root().removeAttribute('style')
    applyFonts({ sans: 'Inter' })
    expect(prop('sans')).toContain('"Inter"')
  })

  it('cannot be made to write a second declaration by a typed name', () => {
    applyFonts({ sans: 'x"; --accent-rgb: 0 0 0; y: "' })
    expect(root().style.getPropertyValue('--accent-rgb')).toBe('')
    expect(prop('sans')).toContain('\\"; --accent-rgb')
  })
})
