#!/usr/bin/env node
/**
 * Tests website/release.js's changesOnly(), which decides how much of a GitHub
 * release body the changelog page shows.
 *
 * Zero dependencies and no browser, same as check-website-links.mjs: website/
 * has no build step, no package.json and no test runner, and this is a pure
 * string function, so a node script that loads the file and calls it is the
 * whole harness. The frontend's vitest only reaches frontend/src.
 *
 * Worth guarding rather than eyeballing: a regex that cuts in the wrong place
 * silently truncates the public changelog, and the failure looks like a short
 * release rather than a bug.
 *
 * Run: node scripts/check-release-notes-extract.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'website', 'release.js'), 'utf8')

// release.js is a browser IIFE that hangs its exports off `window`. A bare
// object is enough of one: changesOnly touches nothing else, and the module
// only reads `navigator` inside detectPlatform, which is never called here.
const sandbox = { window: {}, navigator: {}, fetch: () => {} }
vm.createContext(sandbox)
new vm.Script(source, { filename: 'website/release.js' }).runInContext(sandbox)

const { changesOnly } = sandbox.window.KonnektRelease
const failures = []

function check(name, got, want) {
  if (got !== want) {
    failures.push(`${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`)
  }
}

// A snapshot body as .github/scripts/release-notes.py actually writes it,
// preamble and all. Kept verbatim rather than trimmed to the interesting part:
// the preamble is exactly what this function has to drop.
const SNAPSHOT = `Automatic build of \`main\`, rebuilt nightly when there are new commits.
Each one replaces the last.

Untested, and newer than the [latest release](https://example.com). It can be
broken. Back up your server directory before running it.

Version \`0.1.0-dev.snapshot.00400f8\`, commit 00400f866e6d0e90d695cc08b4b0d538d5d21ad1.

## What's changed

### Features
* Implement in-place auto-updater with download, verify, and install
* Support NeoForge and modern Forge servers

### Fixes
* Stop backups from silently overwriting each other

_36 pull requests are not listed: 24 changed nothing that ships in this build, 12 maintenance or documentation._

**Full changelog**: https://github.com/kollektiv-mc/Konnekt/compare/v0.1.0-alpha.1...00400f8`

const EXPECTED = `## What's changed

### Features
* Implement in-place auto-updater with download, verify, and install
* Support NeoForge and modern Forge servers

### Fixes
* Stop backups from silently overwriting each other`

check('a real snapshot body', changesOnly(SNAPSHOT), EXPECTED)

// The two ends, stated on their own so a failure names which one moved.
check(
  'drops the build preamble',
  changesOnly(SNAPSHOT).startsWith("## What's changed"),
  true,
)
check('drops the accounting footer', /not listed/.test(changesOnly(SNAPSHOT)), false)
check('drops the compare link', /Full changelog/.test(changesOnly(SNAPSHOT)), false)

// Singular, and a reworded footer. The cut is matched on "not listed" so
// rewriting the sentence around it does not turn the footer into content.
check(
  'singular footer',
  changesOnly("## What's changed\n\n### Fixes\n* One thing\n\n_1 pull request is not listed: 1 maintenance or documentation._"),
  "## What's changed\n\n### Fixes\n* One thing",
)
check(
  'reworded footer',
  changesOnly("## What's changed\n\n* A change\n\n_Two others are not listed because they ship nowhere._"),
  "## What's changed\n\n* A change",
)

// No footer at all — every merged pull request was listed, so the compare link
// is the first thing after the sections.
check(
  'no footer, only the compare link',
  changesOnly("## What's changed\n\n### Features\n* A thing\n\n**Full changelog**: https://example.com"),
  "## What's changed\n\n### Features\n* A thing",
)

// Neither marker: nothing to cut, everything under the heading is content.
check(
  'no trailing markers',
  changesOnly("## What's changed\n\n### Features\n* A thing"),
  "## What's changed\n\n### Features\n* A thing",
)

// Hand-written notes have no section to find and are shown whole. Dropping
// them because they predate the generator would blank a real release.
const HAND_WRITTEN = '## First Alpha\n\nSome prose.\n\n### What is included\n\n- A thing'
check('body with no What’s changed heading', changesOnly(HAND_WRITTEN), HAND_WRITTEN)

// The section is found case-insensitively and after CRLF, because a body edited
// through the GitHub web UI comes back with Windows line endings.
check(
  'CRLF body',
  changesOnly("intro\r\n\r\n## What's changed\r\n\r\n* A thing\r\n\r\n_9 pull requests are not listed: x._"),
  "## What's changed\n\n* A thing",
)
check(
  'heading case',
  changesOnly("## WHAT'S CHANGED\n\n* A thing"),
  "## WHAT'S CHANGED\n\n* A thing",
)

// Degenerate inputs. The page calls this before deciding whether to render at
// all, so it has to answer for a release with no notes.
check('empty string', changesOnly(''), '')
check('null', changesOnly(null), '')
check('undefined', changesOnly(undefined), '')

// A footer-shaped line *above* the heading is preamble, not the end marker.
// Cutting on it would return nothing at all.
check(
  'footer-shaped preamble',
  changesOnly("_Not listed here: anything._\n\n## What's changed\n\n* A thing"),
  "## What's changed\n\n* A thing",
)

if (failures.length) {
  console.error(`${failures.length} failing:\n`)
  for (const failure of failures) console.error(`  ${failure}\n`)
  process.exit(1)
}
console.log('release notes extract: all checks passed')
