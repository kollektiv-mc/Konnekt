// Guards against silent main-bundle regressions. No new dependency — uses
// node:zlib directly rather than pulling in a bundle-analyzer package.
//
// Budget covers only the entry chunk (dist/assets/index-*.js): the piece every
// page load pays for. Lazy chunks (charts, WorldsScene, ...) are excluded by
// design — they're fetched on demand, not on first paint.
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

console.log(
  `\nEntry chunk (${entry.file}): ${entry.gzipKB.toFixed(1)} KB gzip (budget: ${ENTRY_BUDGET_KB} KB)`,
)

if (entry.gzipKB > ENTRY_BUDGET_KB) {
  console.error(
    `\n✖ Entry chunk exceeds the ${ENTRY_BUDGET_KB} KB gzip budget by ${(entry.gzipKB - ENTRY_BUDGET_KB).toFixed(1)} KB.`,
  )
  console.error(
    '  If this growth is expected, raise ENTRY_BUDGET_KB in scripts/check-bundle-size.mjs.',
  )
  console.error('  If not, look for a new eager import that should be lazy-loaded instead.')
  process.exit(1)
}

console.log('✓ Entry chunk within budget.')
