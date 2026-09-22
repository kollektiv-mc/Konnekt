import { describe, it, expect } from 'vitest'
import type { LogLine } from '../stores/useConsoleStore'
import { foldQuiet, isFold, isNotable } from './logImportance'

let n = 0
function line(text: string, level: LogLine['level'] = 'dim'): LogLine {
  return { id: ++n, timestamp: '21:14:02', text, level }
}

describe('isNotable', () => {
  it('keeps every tinted level', () => {
    expect(isNotable(line('x', 'warn'))).toBe(true)
    expect(isNotable(line('x', 'error'))).toBe(true)
    expect(isNotable(line('x', 'success'))).toBe(true)
    expect(isNotable(line('x', 'manager'))).toBe(true)
  })

  it('keeps the dim lines an admin reads for', () => {
    expect(isNotable(line('[Server thread/INFO]: Ylva left the game'))).toBe(true)
    expect(isNotable(line('[Server thread/INFO]: Stopping server'))).toBe(true)
    expect(isNotable(line('[Server thread/INFO]: <Halla> gg on the backup timing'))).toBe(true)
    expect(isNotable(line('[Server thread/INFO]: Norrsken has made the advancement [x]'))).toBe(
      true,
    )
  })

  it('folds the chatter', () => {
    expect(isNotable(line('[Server thread/INFO]: Preparing spawn area: 47%'))).toBe(false)
    expect(
      isNotable(line('[Server thread/INFO]: Saving chunks for level ServerLevel[world]')),
    ).toBe(false)
  })
})

describe('foldQuiet', () => {
  it('collapses each run of quiet lines into one fold and keeps the rest in order', () => {
    const a = line('Loading properties')
    const b = line('Generating keypair')
    const c = line('Done (10.8s)!', 'success')
    const d = line('Preparing spawn area: 47%')
    const e = line("Can't keep up!", 'warn')
    const out = foldQuiet([a, b, c, d, e])
    expect(out.map((x) => (isFold(x) ? `fold:${x.lines.length}` : x.text))).toEqual([
      'fold:2',
      'Done (10.8s)!',
      'fold:1',
      "Can't keep up!",
    ])
  })

  it('keys a fold on its first line so it survives new lines arriving', () => {
    const a = line('Loading properties')
    const b = line('Generating keypair')
    const [fold] = foldQuiet([a, b])
    expect(isFold(fold) && fold.id).toBe(a.id)
  })

  it('returns nothing for nothing', () => {
    expect(foldQuiet([])).toEqual([])
  })
})
