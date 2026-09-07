// Guards against silent bundle regressions. No new dependency — uses
// node:zlib directly rather than pulling in a bundle-analyzer package.
//
// Two budgets, because the app pays for its JavaScript at two moments:
//
// 1. The entry chunk (dist/assets/index-*.js): the piece every page load pays
//    for before anything paints.
// 2. Everything else: the lazy tile chunks and the helper chunks they share.
//    These used to be "fetched on demand, not on first paint", which was the
//    whole story when they were two rarely-opened tiles. It is not any more:
//    lib/prefetch.ts evaluates every one of them during idle time after
//    launch, so a lazy chunk that doubles is a startup cost as well as an
//    on-demand one (#281). The set is measured as "every chunk except the
//    entry" rather than by mapping the warm list's specifiers onto hashed
//    file names, and that is exact rather than approximate: check-prefetch
//    asserts every React.lazy chunk is in the warm list, and the entry imports
//    no helper chunk statically (verified in the build this budget was set
//    from), so the closure of the warm list is precisely the non-entry set.
//    Should the entry ever gain a static helper chunk, it is counted here as
//    warmed rather than as entry, which errs on the side of the tighter budget.
//
// Measures the built output, so it needs a build matching the current sources.
// lib/dist-freshness.mjs makes that true rather than assuming it: an unnoticed
// stale dist/ here reports last month's sizes against today's budget, and the
// same assumption in check-token-classes.mjs produced a confident wrong verdict.
import { readdir, readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import { ensureFreshDist } from './lib/dist-freshness.mjs'

// Measured entry-chunk gzip size after the scheduler/config/mods code-split was
// 145.0 KB; budget = that + ~12% headroom, rounded. It was 550 KB when the
// entry still carried CodeMirror, @xyflow and the markdown pipeline eagerly —
// leaving it there now would let the chunk grow 3.7x before anything noticed.
const ENTRY_BUDGET_KB = 165

// Measured warmed total on 2026-09-07, six lazy chunks plus three shared
// helpers: 712.3 KB gzip (WorldsScene 259.4, EditorPanel 179.9, charts 101.3,
// MarkdownBody 98.4, GraphEditor 63.7, CommandLibrary 4.6, helpers 5.0).
// Budget = that + ~12% headroom, rounded, the same method as the entry's.
// Whether the warm-up's *time* is acceptable is a separate question that needs
// a real machine (HEALTH_LOG 2026-08-29 describes the harness); the bytes do
// not, and this is the bytes.
const WARMED_BUDGET_KB = 800

const distAssets = await ensureFreshDist()

const files = (await readdir(distAssets)).filter((f) => f.endsWith('.js'))

const rows = await Promise.all(
  files.map(async (file) => {
    const buf = await readFile(path.join(distAssets, file))
    const gzipKB = gzipSync(buf).length / 1024
    return { file, gzipKB }
  }),
)
rows.sort((a, b) => b.gzipKB - a.gzipKB)

console.log('Bundle sizes (gzip):')
for (const { file, gzipKB } of rows) {
  console.log(`  ${gzipKB.toFixed(1).padStart(8)} KB  ${file}`)
}

const entry = rows.find((r) => /^index-.*\.js$/.test(r.file))
if (!entry) {
  console.error('check-bundle-size: could not find an index-*.js entry chunk in dist/assets')
  process.exit(1)
}

const warmed = rows.filter((r) => r !== entry)
// A build with no lazy chunk at all means the code-split has collapsed back
// into the entry, which the entry budget catches loudly. It also means this
// half of the check would be comparing zero against the budget and passing,
// so say so rather than let a silent zero read as green.
if (warmed.length === 0) {
  console.error('check-bundle-size: found no chunk besides the entry in dist/assets')
  process.exit(1)
}
const warmedKB = warmed.reduce((sum, r) => sum + r.gzipKB, 0)

console.log(
  `\nEntry chunk (${entry.file}): ${entry.gzipKB.toFixed(1)} KB gzip (budget: ${ENTRY_BUDGET_KB} KB)`,
)
console.log(
  `Warmed chunks (${warmed.length} files): ${warmedKB.toFixed(1)} KB gzip (budget: ${WARMED_BUDGET_KB} KB)`,
)

let failed = false

if (entry.gzipKB > ENTRY_BUDGET_KB) {
  failed = true
  console.error(
    `\n✖ Entry chunk exceeds the ${ENTRY_BUDGET_KB} KB gzip budget by ${(entry.gzipKB - ENTRY_BUDGET_KB).toFixed(1)} KB.`,
  )
  console.error(
    '  If this growth is expected, raise ENTRY_BUDGET_KB in scripts/check-bundle-size.mjs.',
  )
  console.error('  If not, look for a new eager import that should be lazy-loaded instead.')
}

if (warmedKB > WARMED_BUDGET_KB) {
  failed = true
  console.error(
    `\n✖ Warmed chunks exceed the ${WARMED_BUDGET_KB} KB gzip budget by ${(warmedKB - WARMED_BUDGET_KB).toFixed(1)} KB.`,
  )
  console.error('  Every chunk besides the entry is evaluated during idle time after launch')
  console.error('  (lib/prefetch.ts), so this is startup work. If the growth is expected, raise')
  console.error(
    '  WARMED_BUDGET_KB in scripts/check-bundle-size.mjs and record the new measurement.',
  )
  console.error('  If not, look at which chunk grew in the table above.')
}

if (failed) process.exit(1)

console.log('✓ Entry chunk and warmed chunks within budget.')
