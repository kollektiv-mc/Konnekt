import type { models } from '../../wailsjs/go/models'

// Settings > What's New reads GitHub Releases through GetReleaseNotes (Go,
// backend/services/release_notes.go): each release body's "## What's changed"
// section, as .github/scripts/release-notes.py wrote it. It used to be a list
// typed by hand here, which nothing in the release flow updated, and it
// stopped at 2026-08-29 while two releases shipped (#638).

/** "Open GitHub for the full changelog" target: every release, newest first. */
export const CHANGELOG_URL = 'https://github.com/kollektiv-mc/Konnekt/releases'

/** The section shown without a click: Features, or the first there is. */
const LEAD_SECTION = 'Features'

/**
 * Splits a release's sections into the one shown up front and the rest,
 * which the pane folds behind a toggle. A release of nothing but fixes leads
 * with its fixes rather than with an empty space.
 */
export function splitSections(sections: readonly models.ReleaseNoteSection[]): {
  lead: models.ReleaseNoteSection | null
  rest: models.ReleaseNoteSection[]
} {
  const leadIndex = Math.max(
    0,
    sections.findIndex((s) => s.title === LEAD_SECTION),
  )
  const lead = sections[leadIndex] ?? null
  return { lead, rest: sections.filter((_, i) => i !== leadIndex) }
}

/** The heading a release is listed under: its tag, or "Snapshot" for the nightly. */
export function releaseLabel(note: Pick<models.ReleaseNote, 'version' | 'snapshot'>): string {
  return note.snapshot ? 'Snapshot' : note.version
}

/** Every item in sections, for the "N more changes" count. */
export function countItems(sections: readonly models.ReleaseNoteSection[]): number {
  return sections.reduce((n, s) => n + s.items.length, 0)
}
