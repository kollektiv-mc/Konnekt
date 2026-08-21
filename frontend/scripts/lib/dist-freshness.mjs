// Shared precondition for the two checks that read `frontend/dist` rather than
// `frontend/src`: check-token-classes.mjs and check-bundle-size.mjs.
//
// The failure this exists for: `pnpm check-tokens` reported `duration-fast` and
// `duration-panel` as compiling to nothing, on a tree where the generator, the
// generated tokens.css and Tailwind were all correct. The build it read was from
// before the fix that added the --transition-duration-* alias, so the verdict
// described a bug that had been fixed two days earlier. Both scripts said
// "Requires a prior `pnpm build`" in a header comment and then trusted whatever
// dist/ happened to hold, which is not a precondition, it is a hope. CI happens
// to satisfy it (ci.yml runs `pnpm build` immediately before both), so the lie
// only ever surfaced locally and in agent runs, which is where the health check
// is actually the definition of done.
//
// It lies in both directions. A dist older than src reports live classes as
// dead, and a dist that still carries a rule the current sources no longer
// produce reports a real regression as green, which is the exact defect
// check-token-classes.mjs was written to catch.
//
// So the precondition is enforced instead of assumed: compare mtimes, and build
// when the build is missing or older than anything that feeds it. Fresh dist
// means no work, which is why this is free in CI, where the build already ran.
// Over-inclusive on inputs on purpose: a spurious rebuild costs ~15s, a stale
// read costs an afternoon.
import { readdir, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const FRONTEND = path.resolve(import.meta.dirname, '..', '..')
const DIST_ASSETS = path.join(FRONTEND, 'dist', 'assets')

// Everything whose change can change the built output. tokens.source.json is in
// here because it is the root of the generated token layer, and it lives at the
// repo root rather than under frontend/.
const INPUTS = [
  path.join(FRONTEND, 'src'),
  path.join(FRONTEND, 'index.html'),
  path.join(FRONTEND, 'vite.config.ts'),
  path.join(FRONTEND, 'package.json'),
  path.join(FRONTEND, '..', 'tokens.source.json'),
]

/** Newest mtime at or under `target`, or 0 if it does not exist. */
async function newestMtime(target) {
  let info
  try {
    info = await stat(target)
  } catch {
    return 0
  }
  if (!info.isDirectory()) return info.mtimeMs
  const entries = await readdir(target, { withFileTypes: true })
  const times = await Promise.all(entries.map((e) => newestMtime(path.join(target, e.name))))
  return Math.max(info.mtimeMs, ...times, 0)
}

// The oldest asset rather than the newest: one build writes them together, so
// the oldest is that build's timestamp, and taking the newest would let a single
// freshly-rewritten file vouch for a directory of stale ones.
async function buildTime() {
  let entries
  try {
    entries = await readdir(DIST_ASSETS)
  } catch {
    return null
  }
  const assets = entries.filter((f) => f.endsWith('.css') || f.endsWith('.js'))
  if (assets.length === 0) return null
  const times = await Promise.all(
    assets.map(async (f) => (await stat(path.join(DIST_ASSETS, f))).mtimeMs),
  )
  return Math.min(...times)
}

/**
 * Guarantee dist/assets reflects the current sources, building if it does not.
 * Returns the dist/assets path. Exits non-zero if the build fails, because a
 * check that cannot see a current build has no verdict to give.
 */
export async function ensureFreshDist() {
  const built = await buildTime()
  const newestInput = Math.max(...(await Promise.all(INPUTS.map(newestMtime))))

  if (built !== null && built >= newestInput) return DIST_ASSETS

  console.log(
    built === null
      ? 'No build found in dist/assets. Building first — this check reads the built output.'
      : 'dist/assets is older than the sources that produced it. Rebuilding — this check\n' +
          'reads the built output, and a stale one gives a confident wrong answer.',
  )

  // shell: true because pnpm is pnpm.cmd on Windows, which spawnSync cannot
  // resolve without one. The whole command is one string rather than a command
  // plus an args array, which is what Node's DEP0190 asks for under shell: true.
  const build = spawnSync('pnpm build', { cwd: FRONTEND, stdio: 'inherit', shell: true })
  if (build.status !== 0) {
    console.error('\n✖ `pnpm build` failed, so there is no current build to check against.')
    console.error('  Fix the build first; this check has no verdict until it succeeds.')
    process.exit(1)
  }

  const rebuilt = await buildTime()
  if (rebuilt === null) {
    console.error('\n✖ `pnpm build` succeeded but wrote no assets to dist/assets.')
    process.exit(1)
  }
  console.log()
  return DIST_ASSETS
}
