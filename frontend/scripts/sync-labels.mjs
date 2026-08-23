// Applies .github/labels.yml to GitHub.
//
// kollektiv's scripts/sync-labels.sh already does this for the suite-owned half
// of the taxonomy, from design/labels.json, against every repo in
// suite.repos.json. What it deliberately does not do is touch anything outside
// that taxonomy: "nothing here deletes a label — including ones outside this
// taxonomy, since a repo may carry its own labels this suite doesn't govern."
//
// Konnekt carries sixteen such labels — the per-area `area:*` set, `milestone:*`
// and `status:*` — and until now had no way to apply them at all. labels.yml
// says so itself: "a declaration, not a mirror". So the file could name a label
// that had never been created, and nothing would say so. That is not
// hypothetical: `p0` and `p3` were declared by the suite convention and absent
// from this repo, while `p1` and `p2` existed with no description and the wrong
// color, and it took someone reading the tracker by hand to notice.
//
// Same contract as the suite script, on purpose:
//   - Idempotent. A label that already matches is left alone.
//   - Non-destructive. Nothing here deletes a label, including ones labels.yml
//     does not declare.
//   - `--check` reports drift and exits non-zero without writing anything.
//
// On the overlap with the suite script: the suite-owned entries in labels.yml
// are verbatim copies of design/labels.json, so both scripts converge on the
// same state and it does not matter which runs. If they ever disagree, the
// suite wins and labels.yml is what needs correcting — `--check` here is how
// that gets noticed, since it compares the declaration against what is live.
//
// Lives in frontend/scripts/ rather than the repo-root scripts/ for the reason
// check-issue-templates.mjs already documents: it needs a YAML parser, and
// `yaml` is a frontend dependency. Same arrangement as `format:website`, a
// frontend-run tool pointed at a path outside frontend/.
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { parse } from 'yaml'

const REPO = 'kollektiv-mc/Konnekt'
const LABELS_FILE = path.join(import.meta.dirname, '..', '..', '.github', 'labels.yml')

const checkOnly = process.argv.includes('--check')
const unknownArgs = process.argv.slice(2).filter((a) => a !== '--check')
if (unknownArgs.length > 0) {
  console.error(
    `usage: node scripts/sync-labels.mjs [--check]\nunexpected: ${unknownArgs.join(' ')}`,
  )
  process.exit(2)
}

// A check that could not run is a failure to report, not a silent pass — the
// same rule check-issue-templates.mjs and scripts/check-website-links.mjs hold
// themselves to.
if (!existsSync(LABELS_FILE)) {
  console.error(`sync-labels: no labels.yml at ${LABELS_FILE}`)
  process.exit(1)
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

try {
  gh(['--version'])
} catch {
  console.error(
    'sync-labels: gh (GitHub CLI) is required — https://cli.github.com, then gh auth login',
  )
  process.exit(1)
}

const declared = parse(readFileSync(LABELS_FILE, 'utf8'))
if (!Array.isArray(declared)) {
  console.error('sync-labels: labels.yml must be a list of labels')
  process.exit(1)
}

let live
try {
  live = JSON.parse(
    gh(['label', 'list', '--repo', REPO, '--limit', '200', '--json', 'name,color,description']),
  )
} catch (err) {
  console.error(`sync-labels: could not list labels on ${REPO}: ${err.message}`)
  process.exit(1)
}
const liveByName = new Map(live.map((l) => [l.name, l]))

// GitHub stores colors without the leading #, lowercased. Normalise both sides
// so a declaration written as "#EDEDED" does not read as permanent drift.
const norm = (c) =>
  String(c ?? '')
    .replace(/^#/, '')
    .toLowerCase()

const created = []
const updated = []
const drifted = []
const missing = []

for (const entry of declared) {
  if (!entry?.name) continue
  const { name } = entry
  const color = norm(entry.color)
  const description = entry.description ?? ''
  const existing = liveByName.get(name)

  if (!existing) {
    if (checkOnly) {
      missing.push(name)
    } else {
      gh(['label', 'create', name, '--repo', REPO, '--color', color, '--description', description])
      created.push(name)
    }
    continue
  }

  if (norm(existing.color) === color && (existing.description ?? '') === description) continue

  if (checkOnly) {
    drifted.push(name)
  } else {
    gh(['label', 'edit', name, '--repo', REPO, '--color', color, '--description', description])
    updated.push(name)
  }
}

if (checkOnly) {
  for (const name of missing) console.error(`! ${REPO} is missing label "${name}"`)
  for (const name of drifted)
    console.error(`! ${REPO} label "${name}" has drifted (color or description)`)
  if (missing.length + drifted.length > 0) {
    console.error(
      `\n✖ sync-labels: ${missing.length} missing, ${drifted.length} drifted. ` +
        `Run \`pnpm sync-labels\` to apply .github/labels.yml.`,
    )
    process.exit(1)
  }
  console.log(`✓ ${REPO}: all ${declared.length} declared labels exist and match.`)
} else {
  for (const name of created) console.log(`+ created "${name}"`)
  for (const name of updated) console.log(`+ updated "${name}"`)
  const unchanged = declared.length - created.length - updated.length
  console.log(
    `\n✓ sync-labels: ${created.length} created, ${updated.length} updated, ${unchanged} already correct.`,
  )
}
