import { describe, it, expect } from 'vitest'
import { parseProblem } from './parseProblem'

describe('parseProblem', () => {
  it('names the line of an unquoted TOML string', () => {
    expect(parseProblem('toml', '[server]\n\tserverKey = frangfurd\n')).toBe(
      'line 2: invalid value',
    )
  })

  it('is null for valid TOML, JSON and YAML', () => {
    expect(parseProblem('toml', '[server]\n\tserverKey = "frangfurd"\n')).toBeNull()
    expect(parseProblem('json', '{"a": 1}')).toBeNull()
    expect(parseProblem('yaml', 'a: 1\n')).toBeNull()
  })

  it('reports broken JSON and YAML', () => {
    expect(parseProblem('json', '{"a":}')).not.toBeNull()
    expect(parseProblem('yaml', 'a: [1\n')).not.toBeNull()
  })

  it('has nothing to say about formats it does not parse', () => {
    expect(parseProblem('properties', '= =')).toBeNull()
    expect(parseProblem('text', '{')).toBeNull()
  })
})
