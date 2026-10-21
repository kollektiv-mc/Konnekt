import { describe, it, expect } from 'vitest'
import { CHANGELOG_URL, countItems, releaseLabel, splitSections } from './changelog'

const section = (title: string, ...items: string[]) => ({ title, items })

describe('CHANGELOG_URL', () => {
  it('is an absolute github.com URL', () => {
    expect(CHANGELOG_URL).toMatch(/^https:\/\/github\.com\//)
  })
})

describe('splitSections', () => {
  it('leads with Features wherever it sits', () => {
    const fixes = section('Fixes', 'a fix')
    const features = section('Features', 'a feature')
    expect(splitSections([fixes, features])).toEqual({ lead: features, rest: [fixes] })
  })

  it('leads with the first section when there are no features', () => {
    const fixes = section('Fixes', 'a fix')
    const other = section('Other changes', 'other')
    expect(splitSections([fixes, other])).toEqual({ lead: fixes, rest: [other] })
  })

  it('has no lead for a release without sections', () => {
    expect(splitSections([])).toEqual({ lead: null, rest: [] })
  })
})

describe('releaseLabel', () => {
  it('names a tagged release by its tag', () => {
    expect(releaseLabel({ version: 'v0.2.0-alpha.2', snapshot: false })).toBe('v0.2.0-alpha.2')
  })

  it('names the nightly Snapshot rather than its long version', () => {
    expect(releaseLabel({ version: '0.2.0-snapshot.202610191616.eeb89c9', snapshot: true })).toBe(
      'Snapshot',
    )
  })
})

describe('countItems', () => {
  it('counts across sections', () => {
    expect(countItems([section('Fixes', 'a', 'b'), section('Other changes', 'c')])).toBe(3)
  })
})
