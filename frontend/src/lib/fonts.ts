/**
 * Per-person font overrides (#444).
 *
 * The default look is the token stacks as generated into `styles/tokens.css`: the
 * suite's named faces first, then the system faces. A chosen family is written in
 * front of its token's own stack on `<html>`, the same inline-override mechanism
 * `lib/theme.ts` uses for the accent, so a name that turns out not to be installed
 * falls through to exactly what the person saw before choosing it.
 *
 * The choice itself lives in `AppSettings.fonts` and is persisted by Go; nothing
 * here touches storage. The list of installed families comes from the
 * `ListFontFamilies` binding, because the Local Font Access API is Chromium-only
 * and Linux and macOS render through WebKit.
 */

/** The `--font-*` tokens a person can override, in the order Settings lists them. */
export const FONT_ROLES = ['sans', 'title', 'display', 'mono'] as const
export type FontRole = (typeof FONT_ROLES)[number]

/** A family per role. An absent role keeps the token's default stack. */
export type FontChoice = Partial<Record<FontRole, string>>

/**
 * The longest family name that is kept. No installed family comes near it; the
 * cap exists so a pasted paragraph cannot become a custom property value the
 * stylesheet has to carry on every element.
 */
export const MAX_FAMILY_LENGTH = 200

/**
 * A typed name made safe to put inside a CSS string: control characters out
 * (a newline ends a CSS string early and the whole declaration is dropped),
 * surrounding space trimmed, the length capped.
 */
export function cleanFamily(name: string): string {
  // \p{Cc} is every control character, which includes the three CSS newlines
  // (LF, CR, FF) and NUL.
  return name
    .replace(/\p{Cc}/gu, ' ')
    .trim()
    .slice(0, MAX_FAMILY_LENGTH)
    .trim()
}

/**
 * A family name as a CSS string. Quoted always, because an unquoted family has to
 * be a sequence of identifiers, and names like "Source Code Pro 2" or
 * "Font-Awesome 6" are not. Backslash and quote are escaped, so no typed name can
 * close the string and carry a declaration out of it.
 */
export function quoteFamily(name: string): string {
  return `"${cleanFamily(name).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * The choice stored in settings, reduced to what can be applied: known roles
 * only, each a non-empty cleaned string. Settings come off disk and over the
 * bridge as `Record<string, string>`, or `null` for a file written before the
 * field existed, so nothing here trusts the shape.
 */
export function normalizeFonts(raw: unknown): FontChoice {
  const choice: FontChoice = {}
  if (typeof raw !== 'object' || raw === null) return choice
  for (const role of FONT_ROLES) {
    const value: unknown = Reflect.get(raw, role)
    if (typeof value !== 'string') continue
    const family = cleanFamily(value)
    if (family) choice[role] = family
  }
  return choice
}

/**
 * Whether the root already carries exactly this choice, so a settings write that
 * did not touch the fonts (every toggle in Settings is one) does not clear and
 * rebuild four custom properties, which restyles the whole document. Read off the
 * element rather than remembered, so a root something else reset is rebuilt.
 */
function isApplied(choice: FontChoice, root: HTMLElement): boolean {
  return FONT_ROLES.every((role) => {
    const current = root.style.getPropertyValue(`--font-${role}`)
    const family = choice[role]
    return family ? current.startsWith(quoteFamily(family)) : current === ''
  })
}

/**
 * Apply a choice to the root element.
 *
 * Every role is cleared first and then rebuilt, rather than patched: the default
 * stack is read back from the stylesheet, which is only possible while no inline
 * override is standing in front of it. `sans` goes first, so a `title` or `display`
 * default that falls back to `var(--font-sans)` already carries the chosen body
 * face.
 */
export function applyFonts(raw: unknown, root: HTMLElement = document.documentElement): void {
  const choice = normalizeFonts(raw)
  if (isApplied(choice, root)) return

  for (const role of FONT_ROLES) root.style.removeProperty(`--font-${role}`)
  for (const role of FONT_ROLES) {
    const family = choice[role]
    if (!family) continue
    const property = `--font-${role}`
    const stack = getComputedStyle(root).getPropertyValue(property).trim()
    root.style.setProperty(
      property,
      stack ? `${quoteFamily(family)}, ${stack}` : quoteFamily(family),
    )
  }
}
