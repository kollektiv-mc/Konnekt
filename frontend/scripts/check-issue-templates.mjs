// Validates .github/ISSUE_TEMPLATE/ against GitHub's issue-form schema, and
// against .github/labels.yml.
//
// GitHub is the only real authority on these files and it reports a broken one
// nowhere except the /issues/new/choose page, where a template that fails to
// parse simply does not appear. Nothing in CI opened .github/ before this
// script: `pnpm format:check` runs from frontend/ and `format:website` from
// website/, so the forms were the one user-facing surface in the repo with no
// gate at all.
//
// The label check is the reason this is worth more than a YAML lint. GitHub
// *ignores* a label a template asks for but the repo does not have, rather than
// erroring, so a typo in `labels:` means the label silently never gets applied
// and triage quietly stops working, with the form still looking perfectly fine.
//
// Lives here rather than in the repo-root scripts/ because it needs a YAML
// parser, and `yaml` is already a frontend dependency (the config tile parses
// server config files with it). Same arrangement as `format:website`: a
// frontend-run tool pointed at a path outside frontend/.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'

const GITHUB_DIR = path.join(import.meta.dirname, '..', '..', '.github')
const TEMPLATE_DIR = path.join(GITHUB_DIR, 'ISSUE_TEMPLATE')
const LABELS_FILE = path.join(GITHUB_DIR, 'labels.yml')

// https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema
const ELEMENT_TYPES = new Set(['markdown', 'input', 'textarea', 'dropdown', 'checkboxes'])

// A check that could not run is a failure to report, not a silent pass — the
// same rule scripts/check-website-links.mjs and .claude/suite-check.py hold
// themselves to.
for (const [label, target] of [
  ['ISSUE_TEMPLATE/', TEMPLATE_DIR],
  ['labels.yml', LABELS_FILE],
]) {
  if (!existsSync(target)) {
    console.error(`check-issue-templates: no ${label} at ${target}`)
    process.exit(1)
  }
}

const problems = []
const fail = (file, message) => problems.push({ file, message })

function load(file, full) {
  try {
    return parse(readFileSync(full, 'utf8'))
  } catch (err) {
    fail(file, `does not parse as YAML: ${err.message}`)
    return null
  }
}

// 1 — labels.yml, which everything else is checked against.
const declaredLabels = new Set()
{
  const doc = load('labels.yml', LABELS_FILE)
  if (doc !== null) {
    if (!Array.isArray(doc)) {
      fail('labels.yml', 'must be a list of labels')
    } else {
      doc.forEach((entry, i) => {
        if (!entry || typeof entry.name !== 'string' || entry.name === '') {
          fail('labels.yml', `entry ${i + 1} has no name`)
          return
        }
        if (declaredLabels.has(entry.name)) fail('labels.yml', `duplicate label "${entry.name}"`)
        declaredLabels.add(entry.name)
      })
    }
  }
}

const files = readdirSync(TEMPLATE_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .sort()

const forms = files.filter((f) => f !== 'config.yml')
if (forms.length === 0) fail('ISSUE_TEMPLATE/', 'contains no issue forms')
if (!files.includes('config.yml')) {
  fail('ISSUE_TEMPLATE/', 'has no config.yml, so the chooser falls back to defaults')
}

// 2 — config.yml. Different schema from a form, so it is checked on its own.
if (files.includes('config.yml')) {
  const doc = load('config.yml', path.join(TEMPLATE_DIR, 'config.yml'))
  if (doc !== null) {
    if (typeof doc.blank_issues_enabled !== 'boolean') {
      fail('config.yml', 'blank_issues_enabled must be present and a boolean')
    }
    const links = doc.contact_links ?? []
    if (!Array.isArray(links)) {
      fail('config.yml', 'contact_links must be a list')
    } else {
      links.forEach((link, i) => {
        const where = `contact_links[${i}]`
        for (const key of ['name', 'url', 'about']) {
          if (!link || typeof link[key] !== 'string' || link[key].trim() === '') {
            fail('config.yml', `${where} is missing "${key}"`)
          }
        }
        if (link?.url && !/^https?:\/\//.test(link.url)) {
          fail('config.yml', `${where} url must be absolute: "${link.url}"`)
        }
      })
      // With blank issues off, the contact links are the only route left for
      // anything the forms do not cover. Losing them all closes the door.
      if (doc.blank_issues_enabled === false && links.length === 0) {
        fail(
          'config.yml',
          'blank issues are off and there are no contact_links, so there is no fallback route',
        )
      }
    }
  }
}

// 3 — the forms themselves.
let fieldCount = 0
const areaOptions = new Map()

for (const file of forms) {
  const doc = load(file, path.join(TEMPLATE_DIR, file))
  if (doc === null) continue

  for (const key of ['name', 'description']) {
    if (typeof doc[key] !== 'string' || doc[key].trim() === '') {
      fail(file, `top-level "${key}" is required`)
    }
  }

  for (const label of doc.labels ?? []) {
    if (!declaredLabels.has(label)) {
      fail(file, `applies label "${label}", which labels.yml does not declare`)
    }
  }

  if (!Array.isArray(doc.body) || doc.body.length === 0) {
    fail(file, '"body" must be a non-empty list')
    continue
  }

  const seenIds = new Set()
  doc.body.forEach((el, i) => {
    const where = `body[${i}]`
    if (!el || !ELEMENT_TYPES.has(el.type)) {
      fail(file, `${where} has an unknown type: ${JSON.stringify(el?.type)}`)
      return
    }

    const attrs = el.attributes ?? {}

    if (el.type === 'markdown') {
      if (typeof attrs.value !== 'string' || attrs.value.trim() === '') {
        fail(file, `${where} is a markdown block with no value`)
      }
      return
    }

    fieldCount++

    if (typeof el.id !== 'string' || el.id.trim() === '') {
      // Without an id the field cannot be prefilled by query parameter, which
      // is what the website form and the in-app reporter are built on.
      fail(file, `${where} (${el.type}) has no id`)
    } else if (seenIds.has(el.id)) {
      fail(file, `${where} reuses the id "${el.id}"`)
    } else {
      seenIds.add(el.id)
    }

    if (typeof attrs.label !== 'string' || attrs.label.trim() === '') {
      fail(file, `${where} (${el.id ?? el.type}) has no attributes.label`)
    }

    if (el.type === 'dropdown') {
      if (!Array.isArray(attrs.options) || attrs.options.length === 0) {
        fail(file, `${where} (${el.id}) is a dropdown with no options`)
      } else if (el.id === 'area') {
        areaOptions.set(file, attrs.options)
      }
    }

    if (el.type === 'checkboxes' && (!Array.isArray(attrs.options) || attrs.options.length === 0)) {
      fail(file, `${where} (${el.id}) is a checkboxes block with no options`)
    }

    // GitHub rejects the pair outright: a rendered field cannot be required.
    if (attrs.render && el.validations?.required === true) {
      fail(
        file,
        `${where} (${el.id}) sets attributes.render and validations.required, which GitHub rejects`,
      )
    }
  })
}

// 4 — the area dropdown is duplicated across forms because issue forms have no
// include mechanism. Triage maps its value onto an area: label, so the two
// lists drifting apart would produce values only one form can emit.
if (areaOptions.size > 1) {
  const [[firstFile, firstOptions], ...rest] = [...areaOptions]
  for (const [file, options] of rest) {
    if (JSON.stringify(options) !== JSON.stringify(firstOptions)) {
      fail(file, `its "area" options differ from ${firstFile}'s; keep the two lists identical`)
    }
  }
}

if (problems.length > 0) {
  console.error(`\n✖ check-issue-templates: ${problems.length} problem(s) in .github/\n`)
  for (const { file, message } of problems) console.error(`  ${file}: ${message}`)
  console.error('')
  process.exit(1)
}

console.log(
  `✓ .github/ISSUE_TEMPLATE: ${forms.length} forms, ${fieldCount} fields, ` +
    `${declaredLabels.size} declared labels — all valid.`,
)
