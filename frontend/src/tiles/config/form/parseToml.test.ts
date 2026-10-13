import { describe, it, expect } from 'vitest'
import { applyTomlEdit, parseTomlFields, tomlIsFormSafe } from './parseToml'

// The shape night-config writes, which is what Distant Horizons and most
// NeoForge mod configs are: a root key, then tables whose keys and comments are
// indented with a tab, a nested table indented a level further.
const DH_SHAPED = [
  '_version = 5',
  '',
  '[server]',
  '\t# Custom server key',
  '\tserverKey = ""',
  '\tserverId = -1534567890',
  '\tlevelKeyPrefix = "" # inline',
  '',
  '[client]',
  '\toptionsButton = true',
  '',
  '\t[client.advanced]',
  '\t\tserverKey = "not this one"',
  '',
].join('\n')

describe('applyTomlEdit', () => {
  it('edits a tab-indented key and keeps its indent', () => {
    const out = applyTomlEdit(DH_SHAPED, ['server', 'serverKey'], 'frangfurd')
    expect(out).toContain('\tserverKey = "frangfurd"')
    expect(out).toContain('\t\tserverKey = "not this one"')
    expect(tomlIsFormSafe(out)).toBe(true)
  })

  it('keeps an inline comment on an indented key', () => {
    const out = applyTomlEdit(DH_SHAPED, ['server', 'levelKeyPrefix'], 'frangfurd')
    expect(out).toContain('\tlevelKeyPrefix = "frangfurd" # inline')
  })

  it('edits a key in a nested, deeper-indented table', () => {
    const out = applyTomlEdit(DH_SHAPED, ['client', 'advanced', 'serverKey'], 'x')
    expect(out).toContain('\t\tserverKey = "x"')
    expect(out).toContain('\tserverKey = ""')
  })

  it('writes a negative integer back as a bare number', () => {
    const out = applyTomlEdit(DH_SHAPED, ['server', 'serverId'], -42)
    expect(out).toContain('\tserverId = -42')
    const server = parseTomlFields(out).find((f) => f.label === 'Server')
    expect(server?.children?.find((f) => f.label === 'Server Id')?.value).toBe(-42)
  })

  it('does not match a key that only starts with the same name', () => {
    const content = '[a]\n\tkeyLonger = 1\n\tkey = 2\n'
    expect(applyTomlEdit(content, ['a', 'key'], 3)).toBe('[a]\n\tkeyLonger = 1\n\tkey = 3\n')
  })

  it('still edits an unindented key', () => {
    expect(applyTomlEdit('[a]\nb = 1\n', ['a', 'b'], 2)).toBe('[a]\nb = 2\n')
  })
})
