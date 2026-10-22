import { describe, expect, it } from 'vitest'
import { NO_SHORT_ID, shortGraphId } from './graphId'

describe('shortGraphId', () => {
  it('keeps the first four characters of a saved id', () => {
    expect(shortGraphId('3f9a0c7e12b4d5e6')).toBe('3f9a')
  })

  it('keeps a shorter id whole', () => {
    expect(shortGraphId('7c')).toBe('7c')
  })

  it('shows the placeholder for an unsaved graph', () => {
    expect(shortGraphId('')).toBe(NO_SHORT_ID)
  })

  it('shows the placeholder when there is no graph', () => {
    expect(shortGraphId(null)).toBe(NO_SHORT_ID)
  })
})
