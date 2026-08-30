import { describe, it, expect, beforeEach } from 'vitest'
import { classifyLine, useConsoleStore } from './useConsoleStore'

describe('classifyLine', () => {
  it('reads level from the log4j-style prefix', () => {
    expect(classifyLine('[12:00:00] [Server thread/ERROR]: boom')).toBe('error')
    expect(classifyLine('[12:00:00] [Server thread/FATAL]: boom')).toBe('error')
    expect(classifyLine('[12:00:00] [Server thread/WARN]: careful')).toBe('warn')
    expect(classifyLine('[12:00:00] [Server thread/DEBUG]: noise')).toBe('dim')
  })

  it('flags success special-cases even under an INFO prefix', () => {
    expect(classifyLine('[12:00:00] [Server thread/INFO]: Done (1.2s)!')).toBe('success')
    expect(classifyLine('[12:00:00] [Server thread/INFO]: Steve joined the game')).toBe('success')
  })

  it('defaults an unremarkable INFO line to dim', () => {
    expect(classifyLine('[12:00:00] [Server thread/INFO]: Saving world')).toBe('dim')
  })

  it('falls back to substring heuristics for unstructured lines', () => {
    expect(classifyLine('Done (1.2s)!')).toBe('success')
    expect(classifyLine("Can't keep up! Is the server overloaded?")).toBe('warn')
    expect(classifyLine('java.lang.RuntimeException: ERROR at line 4')).toBe('error')
    expect(classifyLine('some unstructured plugin chatter')).toBe('dim')
  })
})

// Manager lines are identified by the backend's source marker, never by
// their text (#113). That is the whole point: "Backup failed: ..." would
// otherwise trip classifyLine's substring fallback and read as a server
// error. The outcome rides the same marker, for the same reason: the word
// "failed" in a line is not what makes its dot red.
describe('useConsoleStore manager lines', () => {
  beforeEach(() => {
    useConsoleStore.setState({ lines: [] })
  })

  const lines = () => useConsoleStore.getState().lines

  it('levels a manager line by its marker, not its words', () => {
    useConsoleStore.getState().batchAppend([
      {
        timestamp: '12:00:00',
        line: 'Backup failed: disk error',
        source: 'manager',
        outcome: 'failed',
      },
      { timestamp: '12:00:01', line: '[12:00:01] [Server thread/ERROR]: boom' },
    ])

    expect(lines()[0].level).toBe('manager')
    expect(lines()[0].outcome).toBe('failed')
    expect(lines()[1].level).toBe('error')
  })

  it('reads each outcome the backend emits', () => {
    useConsoleStore.getState().batchAppend([
      { timestamp: '12:00:00', line: 'Backing up', source: 'manager', outcome: 'progress' },
      { timestamp: '12:00:01', line: 'Backup finished', source: 'manager', outcome: 'ok' },
      { timestamp: '12:00:02', line: 'Backup failed', source: 'manager', outcome: 'failed' },
    ])

    expect(lines().map((l) => l.outcome)).toEqual(['progress', 'ok', 'failed'])
  })

  // A manager line from a path that predates the outcome marker, or one
  // carrying a value a later backend adds, still gets a dot — the neutral one.
  // Guessing 'ok' or 'failed' here would claim something nobody reported.
  it('falls back to progress for a missing or unknown outcome', () => {
    useConsoleStore.getState().batchAppend([
      { timestamp: '12:00:00', line: 'Pausing world saves', source: 'manager' },
      { timestamp: '12:00:01', line: 'Something new', source: 'manager', outcome: 'sideways' },
    ])

    expect(lines().map((l) => l.outcome)).toEqual(['progress', 'progress'])
  })

  it('classifies a line with no marker as server output', () => {
    useConsoleStore.getState().batchAppend([{ timestamp: '12:00:00', line: 'Done (1.2s)!' }])
    useConsoleStore.getState().appendLine('12:00:01', 'Steve joined the game')

    expect(lines()[0].level).toBe('success')
    expect(lines()[1].level).toBe('success')
    // No marker, no outcome: a server line never gets a dot, whatever it says.
    expect(lines().every((l) => l.outcome === undefined)).toBe(true)
  })

  it('carries both markers through appendLine and loadHistory', () => {
    useConsoleStore.getState().appendLine('12:00:00', 'Resuming world saves', 'manager', 'ok')
    expect(lines()[0].level).toBe('manager')
    expect(lines()[0].outcome).toBe('ok')

    useConsoleStore.getState().loadHistory([
      {
        timestamp: '11:59:00',
        line: 'Pausing world saves',
        source: 'manager',
        outcome: 'progress',
      },
      { timestamp: '11:59:01', line: '[12:00:00] [Server thread/WARN]: careful', source: '' },
    ])
    expect(lines().map((l) => l.level)).toEqual(['manager', 'warn'])
    expect(lines().map((l) => l.outcome)).toEqual(['progress', undefined])
  })
})

describe('useConsoleStore buffer capping', () => {
  beforeEach(() => {
    useConsoleStore.setState({ lines: [] })
  })

  it('appendLine never exceeds the default 1000-line cap', () => {
    for (let i = 0; i < 1005; i++) {
      useConsoleStore.getState().appendLine('12:00:00', `line ${i}`)
    }
    const lines = useConsoleStore.getState().lines
    expect(lines.length).toBe(1000)
    // the oldest 5 lines should have been evicted, keeping the tail
    expect(lines[0].text).toBe('line 5')
    expect(lines[lines.length - 1].text).toBe('line 1004')
  })

  it('batchAppend trims a single oversized batch down to the cap', () => {
    const incoming = Array.from({ length: 1200 }, (_, i) => ({
      timestamp: '12:00:00',
      line: `batch ${i}`,
    }))
    useConsoleStore.getState().batchAppend(incoming)
    const lines = useConsoleStore.getState().lines
    expect(lines.length).toBe(1000)
    expect(lines[0].text).toBe('batch 200')
    expect(lines[lines.length - 1].text).toBe('batch 1199')
  })

  it('batchAppend is a no-op for an empty batch', () => {
    useConsoleStore.getState().appendLine('12:00:00', 'existing')
    useConsoleStore.getState().batchAppend([])
    expect(useConsoleStore.getState().lines.length).toBe(1)
  })

  it('clear empties the buffer', () => {
    useConsoleStore.getState().appendLine('12:00:00', 'line')
    useConsoleStore.getState().clear()
    expect(useConsoleStore.getState().lines).toEqual([])
  })
})
