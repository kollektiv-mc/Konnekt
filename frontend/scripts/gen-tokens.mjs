#!/usr/bin/env node
//
// Generate the design-token layer from the suite's shared token source.
//
//   tokens.source.json  ->  src/styles/tokens.css   (Tailwind theme + themed values)
//                       ->  src/styles/tokens.ts    (the same defaults, for applySkin)
//
// The source is vendored from kollektiv/design/tokens.json by that repo's
// scripts/sync-tokens.sh, and is deliberately tech-neutral: colours are
// { hex, alpha }, easings are four numbers, sizes are bare numbers with a unit on
// the group. Turning that into CSS is this file's whole job — the shared source
// stays free of anything Tailwind- or CSS-specific.
//
// Run with: pnpm gen:tokens

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const SOURCE = new URL('../../tokens.source.json', import.meta.url)
const CSS_OUT = new URL('../src/styles/tokens.css', import.meta.url)
const TS_OUT = new URL('../src/styles/tokens.ts', import.meta.url)

const SUPPORTED_VERSION = 1

// Semantic token name -> the utility suffix it is exposed under. Tailwind maps
// --color-canvas to bg-canvas/text-canvas/border-canvas, so this is where
// "bg-base" becomes "canvas". It lives here rather than in the shared source
// because it is a Tailwind concern, not a design decision.
const UTILITY_ALIAS = {
  'bg-base': 'canvas',
  'bg-elevated': 'elevated',
  'bg-surface': 'surface',
  'hover-surface': 'hover',
}

// Directional border utilities: border-t-hairline, border-b-hairline, etc.
// Four sides, not x/y — every call site in the tree wants one edge, never a pair.
const BORDER_SIDES = { t: 'top', r: 'right', b: 'bottom', l: 'left' }

// Tailwind's built-in font-size scale keys. A colour exposed under one of these
// names produces --color-<key>, which generates a text-<key> *colour* utility that
// silently shadows the font-size utility of the same name. This bit the codebase
// once with `base`; the guard is here so it cannot happen again from the JSON side.
const RESERVED_UTILITY_NAMES = new Set([
  'xs',
  'sm',
  'base',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
  '6xl',
  '7xl',
  '8xl',
  '9xl',
])

// Font family names that must stay unquoted — generic families and system
// keywords are CSS-wide identifiers, not font names. Everything else gets quoted.
const BARE_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
  '-apple-system',
  'BlinkMacSystemFont',
])

function fail(message) {
  console.error(`gen-tokens: ${message}`)
  process.exit(1)
}

// ── Validation ──────────────────────────────────────────────────────────────
// The authoritative contract is kollektiv/design/tokens.schema.json. These are
// the checks worth repeating here: the ones whose failure would otherwise produce
// plausible-looking CSS with the wrong values in it.

function validate(src) {
  if (src.version !== SUPPORTED_VERSION) {
    fail(
      `token source is version ${src.version}, this generator understands ${SUPPORTED_VERSION}. ` +
        `Update the generator rather than the source.`,
    )
  }

  for (const group of ['surface', 'border', 'text', 'status']) {
    if (!src.color?.[group]) fail(`missing color.${group}`)
  }
  for (const group of ['type', 'space', 'radius', 'border', 'motion']) {
    if (!src[group]) fail(`missing ${group}`)
  }

  for (const [group, tokens] of Object.entries(src.color)) {
    for (const [name, token] of Object.entries(tokens)) {
      if (!token.dark?.hex) fail(`color.${group}.${name} has no dark value`)
      for (const mode of ['dark', 'light']) {
        const value = token[mode]
        if (value == null) continue
        if (!/^#[0-9a-f]{6}$/.test(value.hex)) {
          fail(`color.${group}.${name}.${mode}: "${value.hex}" is not a six-digit lowercase hex`)
        }
        if (value.alpha != null && !(value.alpha > 0 && value.alpha < 1)) {
          fail(`color.${group}.${name}.${mode}: alpha ${value.alpha} must be between 0 and 1`)
        }
      }

      const utility = UTILITY_ALIAS[name] ?? name
      if (RESERVED_UTILITY_NAMES.has(utility)) {
        fail(
          `color.${group}.${name} maps to the utility name "${utility}", which is one of ` +
            `Tailwind's font-size scale keys. --color-${utility} would hijack the ` +
            `text-${utility} utility into a colour rule. Rename the token or its alias.`,
        )
      }
    }
  }

  if (src.motion.easing.standard?.length !== 4) fail('motion.easing.standard must be four numbers')
}

// ── Value formatting ────────────────────────────────────────────────────────

function channels(hex) {
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

function css(color) {
  if (color.alpha == null) return color.hex
  return `rgba(${channels(color.hex).replaceAll(' ', ', ')}, ${color.alpha})`
}

function scalar(value, unit) {
  return `${value}${unit}`
}

function fontStack(families, all) {
  return families
    .map((family) => {
      if (family.startsWith('@')) {
        const target = family.slice(1)
        if (!all[target]) fail(`font stack references "@${target}", which is not defined`)
        return `var(--font-${target})`
      }
      return BARE_FAMILIES.has(family) ? family : `'${family}'`
    })
    .join(', ')
}

// ── CSS emission ────────────────────────────────────────────────────────────

const BANNER = (source) => `/* GENERATED FILE — DO NOT EDIT.
 *
 * Produced by frontend/scripts/gen-tokens.mjs from ${source}, which is vendored
 * from kollektiv/design/tokens.json. Hand edits are reverted by the next run and
 * never reach Kommands, which derives its tokens from the same source.
 *
 * To change a value: edit kollektiv/design/tokens.json, run its
 * scripts/sync-tokens.sh, then \`pnpm gen:tokens\` here.
 */`

function emitCss(src) {
  const lines = []
  const push = (line = '') => lines.push(line)

  push(BANNER('tokens.source.json'))
  push()
  push(`/* Colours are \`inline\` so a utility resolves straight to the themed custom`)
  push(`   property below — bg-canvas becomes background-color: var(--bg-base), which is`)
  push(`   what lets applySkin() retheme by overriding --bg-base at runtime. */`)
  push(`@theme inline {`)
  for (const tokens of Object.values(src.color)) {
    for (const name of Object.keys(tokens)) {
      const utility = UTILITY_ALIAS[name] ?? name
      push(`  --color-${utility}: var(--${name});`)
    }
  }
  push(`}`)

  push()
  push(`/* Everything else is a plain @theme block, deliberately not \`inline\`. Under`)
  push(`   \`inline\` Tailwind substitutes the literal into each utility and never emits`)
  push(`   the custom property, so --radius-panel would compile rounded-panel correctly`)
  push(`   while var(--radius-panel) resolved to nothing in hand-written CSS. These`)
  push(`   values are not runtime-themed, so there is nothing to gain from inlining and`)
  push(`   a whole documented usage to lose. */`)
  push(`@theme {`)

  push(`  /* Type. 12px is the body size in this UI, not 16px, so the scale names three`)
  push(`     steps below Tailwind's smallest: 1xs < 2xs < 3xs. */`)
  for (const [name, value] of Object.entries(src.type.size.scale)) {
    push(`  --text-${name}: ${scalar(value, src.type.size.unit)};`)
  }
  push()
  for (const [name, families] of Object.entries(src.type.family)) {
    push(`  --font-${name}: ${fontStack(families, src.type.family)};`)
  }

  push()
  push(`  /* Radius. Concentric radii matter at hairline border weights — mismatched`)
  push(`     values rasterise unevenly and read as a rendering bug. */`)
  for (const [name, value] of Object.entries(src.radius.scale)) {
    push(`  --radius-${name}: ${scalar(value, src.radius.unit)};`)
  }

  push()
  push(`  /* Motion. Reuse these instead of inventing per-component durations`)
  push(`     (agent_docs/HEALTH_CHECKLIST.md, Clean pillar). --ease-standard is`)
  push(`     Tailwind's ease-in-out bezier, spelled out so plain CSS can reuse it. */`)
  for (const [name, value] of Object.entries(src.motion.duration.scale)) {
    push(`  --duration-${name}: ${scalar(value, src.motion.duration.unit)};`)
  }
  for (const [name, points] of Object.entries(src.motion.easing)) {
    push(`  --ease-${name}: cubic-bezier(${points.join(', ')});`)
  }

  push()
  push(`  /* Border widths. Tailwind v4 has no --border-width-* namespace, so these are`)
  push(`     plain custom properties surfaced as utilities by the @utility rules below. */`)
  for (const [name, value] of Object.entries(src.border.scale)) {
    push(`  --border-${name}: ${scalar(value, src.border.unit)};`)
  }

  push()
  push(`  /* Space is deliberately not emitted. Tailwind's default --spacing: 0.25rem`)
  push(`     already yields p-0.5 = 2px through p-6 = 24px, identical to the shared`)
  push(`     scale, and re-declaring it would add a second thing to keep in step.`)
  push(`     Font weights are likewise covered by font-normal/medium/semibold/black. */`)
  push(`}`)

  push()
  push(`/* Hairline borders are the signature of this design language; they need to be`)
  push(`   as reachable as any colour utility, not an arbitrary [0.5px] value. Per-side`)
  push(`   variants exist alongside the all-sides one because call sites overwhelmingly`)
  push(`   want one edge (a header divider, a panel's bottom rule), not all four; an`)
  push(`   unused combination costs nothing since Tailwind only emits what a scan finds. */`)
  for (const name of Object.keys(src.border.scale)) {
    push(`@utility border-${name} {`)
    push(`  border-width: var(--border-${name});`)
    push(`}`)
  }
  for (const [side, prop] of Object.entries(BORDER_SIDES)) {
    for (const name of Object.keys(src.border.scale)) {
      push(`@utility border-${side}-${name} {`)
      push(`  border-${prop}-width: var(--border-${name});`)
      push(`}`)
    }
  }

  const emitTheme = (selector, mode) => {
    push()
    push(`${selector} {`)
    for (const [group, tokens] of Object.entries(src.color)) {
      for (const [name, token] of Object.entries(tokens)) {
        const value = token[mode]
        // A null light value means the token inherits its dark one; emitting it
        // again would be a second copy to keep in step for no behavioural gain.
        if (value == null) continue
        if (group === 'status') {
          // Channel triplets, so alpha composes from one token:
          // rgb(var(--accent-rgb) / 0.2) needs no second --accent-20 token.
          push(`  --${name}-rgb: ${channels(value.hex)};`)
          if (mode === 'dark') push(`  --${name}: rgb(var(--${name}-rgb));`)
        } else {
          push(`  --${name}: ${css(value)};`)
        }
      }
    }
    push(`}`)
  }

  emitTheme(`:root,\n[data-theme='dark']`, 'dark')
  emitTheme(`[data-theme='light']`, 'light')

  push()
  return lines.join('\n')
}

// ── TS emission ─────────────────────────────────────────────────────────────

function emitTs(src) {
  const status = src.color.status
  const roles = Object.keys(status)
  const configurable = roles.filter((role) => status[role].userConfigurable)

  const table = (mode) =>
    roles
      // A null light value inherits the dark one. Resolving that here means
      // consumers read a complete table instead of re-implementing the rule.
      .map((role) => `  ${role}: '${(status[role][mode] ?? status[role].dark).hex}',`)
      .join('\n')

  return `${BANNER('tokens.source.json')}

export type ThemeMode = 'dark' | 'light'

/** Status roles the user can override at runtime from Settings. */
export const CONFIGURABLE_STATUS_ROLES = [
${configurable.map((role) => `  '${role}',`).join('\n')}
] as const

export type ConfigurableStatusRole = (typeof CONFIGURABLE_STATUS_ROLES)[number]

/**
 * Per-theme defaults for the status colours.
 *
 * \`dark\` doubles as the *stored* default: persisted settings hold one colour per
 * role regardless of the active theme, and it is seeded from this table. That is
 * why applySkin() compares a user's colour against \`dark\` to decide whether it was
 * actually customised — see frontend/src/lib/theme.ts.
 */
export const STATUS_DEFAULTS: Record<ThemeMode, Record<string, string>> = {
  dark: {
${table('dark')}
  },
  light: {
${table('light')}
  },
}
`
}

// ── Main ────────────────────────────────────────────────────────────────────

let raw
try {
  raw = readFileSync(SOURCE, 'utf8')
} catch {
  fail(
    `no tokens.source.json at the repo root. It is vendored from kollektiv — run ` +
      `scripts/sync-tokens.sh from the kollektiv workspace root.`,
  )
}

let src
try {
  src = JSON.parse(raw)
} catch (error) {
  fail(`tokens.source.json is not valid JSON: ${error.message}`)
}

validate(src)

for (const out of [CSS_OUT, TS_OUT]) {
  mkdirSync(dirname(fileURLToPath(out)), { recursive: true })
}

writeFileSync(CSS_OUT, emitCss(src))
writeFileSync(TS_OUT, emitTs(src))

console.log('gen-tokens: wrote src/styles/tokens.css and src/styles/tokens.ts')
