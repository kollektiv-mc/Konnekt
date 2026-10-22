import { describe, expect, it } from 'vitest'
import { blockDocsUrl, DOCS_URL } from './docs'

describe('blockDocsUrl', () => {
  it('turns the dots in a block type into hyphens', () => {
    expect(blockDocsUrl('trigger.player')).toBe(`${DOCS_URL}/blocks/trigger-player`)
  })
})
