// Asserts that lib/prefetch.ts's warm list names the same modules the
// `React.lazy` declarations under src/tiles/ do.
//
// This exists because the failure has no symptom. Vite keys a chunk by resolved
// specifier, so a warm path that differs from its lazy path by a directory hop
// resolves to a *second copy* of the module: the build succeeds, the tile still
// opens, the warm-up silently buys nothing, and the only evidence is a stutter
// on someone's machine months later. Same shape as a token-named class
// compiling to no rule, which is why check-token-classes.mjs exists — so this
// gets the same treatment rather than a line in the checklist asking a reader
// to remember.
//
// Catches all three ways the two drift: a new lazy tile chunk nobody added to
// the warm list, a warm entry whose path moved, and a warm entry left behind
// after its lazy declaration went away.
//
// Reads source rather than build output, so it needs no build and runs in the
// same second as lint.
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const PREFETCH = path.join(SRC, 'lib', 'prefetch.ts')

async function sourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (e) => {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) return sourceFiles(full)
      if (!/\.tsx?$/.test(e.name) || e.name.includes('.test.')) return []
      return [full]
    }),
  )
  return nested.flat()
}

async function isFile(p) {
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

// Vite lets an import omit the extension; resolving the same way is what makes
// a typo'd specifier fail here rather than at runtime.
async function resolveModule(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.tsx')]) {
    if (await isFile(candidate)) return path.relative(SRC, candidate).replaceAll(path.sep, '/')
  }
  const where = path.relative(SRC, fromFile).replaceAll(path.sep, '/')
  console.error(`✖ ${where} imports '${specifier}', which resolves to no file.`)
  process.exit(1)
}

async function specifiers(file, pattern) {
  const source = await readFile(file, 'utf8')
  const found = [...source.matchAll(pattern)].map(([, spec]) => spec)
  return Promise.all(found.map((spec) => resolveModule(file, spec)))
}

const LAZY_IMPORT = /lazy\(\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]/g
const WARM_IMPORT = /\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]/g

const tiles = await sourceFiles(path.join(SRC, 'tiles'))
const lazyChunks = new Set((await Promise.all(tiles.map((f) => specifiers(f, LAZY_IMPORT)))).flat())
const warmChunks = new Set(await specifiers(PREFETCH, WARM_IMPORT))

// A regex that quietly stopped matching would make every comparison below pass
// against an empty set, which is the one way this check can rot without failing.
if (lazyChunks.size === 0) {
  console.error('✖ Found no React.lazy chunks under src/tiles — the pattern this check')
  console.error('  scans for has probably drifted. Fix the pattern, do not delete the check.')
  process.exit(1)
}

const sorted = (set) => [...set].sort()
console.log('Lazy tile chunks:')
for (const chunk of sorted(lazyChunks)) {
  console.log(`  ${warmChunks.has(chunk) ? '✓ warmed' : '✖ NOT warmed'}  ${chunk}`)
}

const unwarmed = sorted(lazyChunks).filter((c) => !warmChunks.has(c))
const stale = sorted(warmChunks).filter((c) => !lazyChunks.has(c))

if (unwarmed.length > 0) {
  console.error(`\n✖ ${unwarmed.length} lazy chunk(s) missing from lib/prefetch.ts's CHUNKS:`)
  for (const c of unwarmed) console.error(`    ${c}`)
  console.error('  Add each one, spelled relative to lib/ — the specifier has to resolve to the')
  console.error('  same module, or Vite emits a second copy and the warm-up does nothing.')
}
if (stale.length > 0) {
  console.error(`\n✖ ${stale.length} entr(y/ies) in CHUNKS no longer match a React.lazy call:`)
  for (const c of stale) console.error(`    ${c}`)
  console.error('  Either the lazy declaration moved, or it is gone and this entry is stale.')
}
if (unwarmed.length > 0 || stale.length > 0) process.exit(1)

console.log(`\n✓ All ${lazyChunks.size} lazy tile chunks are in the warm list.`)
