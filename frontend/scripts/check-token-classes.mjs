#!/usr/bin/env node
//
// Guards against a token-named Tailwind class that compiles to nothing.
//
// The failure this exists for: tokens.css emitted --duration-fast into its @theme
// block, and source files used `duration-fast` as a class. But Tailwind v4 resolves
// duration-* against the --transition-duration-* namespace, not --duration-*, so the
// class produced no rule at all and the element silently fell back to Tailwind's own
// --default-transition-duration. That default is 150ms, exactly --duration-fast's
// value, so nothing looked wrong and the checklist recorded the two dead call sites
// as evidence the utility worked. Run against the build from before that fix, this
// script prints `duration-fast` as used-but-uncompiled, which is the whole point.
//
// The generated-file check in .claude/suite.json cannot catch this: it verifies the
// token files round-trip, not that the CSS they produce yields working utilities.
//
// Method: build the candidate class names from tokens.source.json (the source, not
// the generated CSS — the generator iterates the same structure), keep the ones
// frontend/src actually uses, and assert each has a rule in the built CSS.
//
// Requires a prior `pnpm build`, same as check-bundle-size.mjs.
//
// Run with: pnpm check-tokens
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const here = import.meta.dirname
const SOURCE = path.join(here, '..', '..', 'tokens.source.json')
const SRC_DIR = path.join(here, '..', 'src')
const DIST_ASSETS = path.join(here, '..', 'dist', 'assets')

// Which Tailwind utility prefixes read which theme namespace. Taken from the
// utility registrations in tailwindcss/dist/lib.js rather than from the docs, and
// worth re-deriving there if this ever needs extending: the whole bug class is
// "the namespace a utility reads is not the one we assumed".
const COLOR_PREFIXES = [
  'bg',
  'text',
  'border',
  'border-t',
  'border-r',
  'border-b',
  'border-l',
  'outline',
  'caret',
  'accent',
  'decoration',
  'placeholder',
  'divide',
  'ring',
  'fill',
  'stroke',
  'from',
  'via',
  'to',
]
const RADIUS_PREFIXES = [
  'rounded',
  'rounded-t',
  'rounded-r',
  'rounded-b',
  'rounded-l',
  'rounded-tl',
  'rounded-tr',
  'rounded-br',
  'rounded-bl',
]
const BORDER_WIDTH_PREFIXES = ['border', 'border-t', 'border-r', 'border-b', 'border-l']

// Mirrors gen-tokens.mjs's own alias table. Duplicated on purpose: importing the
// generator would run it, and a check that shares its subject's code cannot
// disagree with it.
const UTILITY_ALIAS = {
  'bg-base': 'canvas',
  'bg-elevated': 'elevated',
  'bg-overlay': 'overlay',
  'bg-surface': 'surface',
  'hover-surface': 'hover',
}

const src = JSON.parse(await readFile(SOURCE, 'utf8'))

/** @type {{ cls: string, group: string }[]} */
const candidates = []
const add = (cls, group) => candidates.push({ cls, group })

for (const tokens of Object.values(src.color)) {
  for (const name of Object.keys(tokens)) {
    const utility = UTILITY_ALIAS[name] ?? name
    for (const prefix of COLOR_PREFIXES) add(`${prefix}-${utility}`, 'colour')
  }
}
for (const name of Object.keys(src.type.size.scale)) add(`text-${name}`, 'type size')
for (const name of Object.keys(src.type.family)) add(`font-${name}`, 'font family')
for (const name of Object.keys(src.radius.scale)) {
  for (const prefix of RADIUS_PREFIXES) add(`${prefix}-${name}`, 'radius')
}
for (const name of Object.keys(src.motion.duration.scale)) {
  add(`duration-${name}`, 'motion')
  add(`delay-${name}`, 'motion')
}
for (const name of Object.keys(src.motion.easing)) add(`ease-${name}`, 'motion')
for (const name of Object.keys(src.border.scale)) {
  for (const prefix of BORDER_WIDTH_PREFIXES) add(`${prefix}-${name}`, 'border width')
}

// A class name's boundary must not treat `-` as a separator. Otherwise the text
// `var(--border-hover)` reads as a use of a class called `border-hover`, and every
// custom-property declaration in the tree becomes a false positive.
const EDGE = '[^A-Za-z0-9_-]'
const usePattern = (cls) => new RegExp(`(^|${EDGE})${cls}(${EDGE}|$)`)
const rulePattern = (cls) => new RegExp(`\\.${cls}(${EDGE}|$)`)

async function filesUnder(dir, exts) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await filesUnder(full, exts)))
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full)
  }
  return out
}

// tokens.css and tokens.ts are the generated files themselves: they define the
// properties, they do not use the classes.
const sourceFiles = (await filesUnder(SRC_DIR, ['.ts', '.tsx', '.css'])).filter(
  (f) => !f.includes(path.join('src', 'styles', 'tokens.')),
)
const sourceText = (await Promise.all(sourceFiles.map((f) => readFile(f, 'utf8')))).join('\n')

let cssFiles
try {
  cssFiles = (await readdir(DIST_ASSETS)).filter((f) => f.endsWith('.css'))
} catch {
  console.error('✖ No dist/assets found. Run `pnpm build` first.')
  process.exit(1)
}
if (cssFiles.length === 0) {
  console.error('✖ dist/assets has no CSS. Run `pnpm build` first.')
  process.exit(1)
}
const builtCss = (
  await Promise.all(cssFiles.map((f) => readFile(path.join(DIST_ASSETS, f), 'utf8')))
).join('\n')

const used = candidates.filter(({ cls }) => usePattern(cls).test(sourceText))
const dead = used.filter(({ cls }) => !rulePattern(cls).test(builtCss))

const byGroup = new Map()
for (const { group } of used) byGroup.set(group, (byGroup.get(group) ?? 0) + 1)

console.log(`Token-named classes used in src/ (of ${candidates.length} possible):`)
for (const [group, count] of [...byGroup].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(3)}  ${group}`)
}
console.log(`  ${String(used.length).padStart(3)}  total`)

// A token class nothing references is not a failure: Tailwind only emits what its
// scan finds, which is why the generator can emit every border side unconditionally.

if (dead.length > 0) {
  console.error(`\n✖ ${dead.length} token class(es) are used in src/ but compile to nothing:`)
  for (const { cls, group } of dead) console.error(`    ${cls}  (${group})`)
  console.error(
    '\n  The token exists and the class is written, but Tailwind emitted no rule for it,',
  )
  console.error('  so the element silently falls back to a Tailwind default that may look right.')
  console.error('  Tailwind reads a specific theme namespace per utility, and it is often not the')
  console.error('  one the token is named after: duration-* reads --transition-duration-*, ease-*')
  console.error('  reads --ease-*. Fix it in scripts/gen-tokens.mjs by emitting the namespace')
  console.error('  Tailwind actually resolves, or an explicit @utility rule, as the border')
  console.error('  widths already do. Never by hand-editing tokens.css.')
  process.exit(1)
}

console.log('\n✓ Every token class used in src/ compiles to a rule.')
