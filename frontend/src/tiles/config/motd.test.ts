import { describe, it, expect } from 'vitest'
import { decodeEscapes, parseMotdLine } from './motd'

describe('decodeEscapes', () => {
  it('decodes every unicode escape, not only the section sign', () => {
    expect(decodeEscapes('\\u00A7aSurvival \\u00A78\\u00B7')).toBe('§aSurvival §8·')
  })

  it('leaves text with no escapes alone', () => {
    expect(decodeEscapes('A Minecraft Server')).toBe('A Minecraft Server')
  })
})

describe('parseMotdLine', () => {
  it('splits escaped source into coloured runs', () => {
    const runs = parseMotdLine('\\u00A7aSurvival \\u00A78\\u00B7 hi')
    expect(runs.map((r) => r.text)).toEqual(['Survival ', '· hi'])
    expect(runs[0].color).toBe('#55FF55')
    expect(runs[1].color).toBe('#555555')
  })
})
