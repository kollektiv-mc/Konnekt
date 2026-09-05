import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  fmtCount,
  fmtBytes,
  fmtDate,
  relativeMs,
  relativeTime,
  truncateStart,
  untilMs,
} from './format'

describe('truncateStart', () => {
  it('leaves short strings alone', () => {
    expect(truncateStart('/srv/mc', 20)).toBe('/srv/mc')
    expect(truncateStart('', 20)).toBe('')
  })

  it('keeps the tail, which is the identifying part of a path', () => {
    expect(truncateStart('/home/alex/servers/neoforge', 12)).toBe('…rs/neoforge')
  })

  it('never exceeds the budget', () => {
    const path = '/very/long/path/to/a/minecraft/server/directory'
    for (const max of [1, 2, 5, 12, 30]) {
      expect(truncateStart(path, max).length).toBe(max)
    }
  })

  it('handles a string exactly at the budget', () => {
    expect(truncateStart('abcde', 5)).toBe('abcde')
    expect(truncateStart('abcdef', 5)).toBe('…cdef')
  })

  it('returns empty for a non-positive budget', () => {
    expect(truncateStart('/srv/mc', 0)).toBe('')
  })
})

describe('fmtCount', () => {
  it('renders small numbers as-is', () => {
    expect(fmtCount(0)).toBe('0')
    expect(fmtCount(42)).toBe('42')
    expect(fmtCount(999)).toBe('999')
  })

  it('renders thousands with a k suffix', () => {
    expect(fmtCount(1_000)).toBe('1k')
    expect(fmtCount(1_500)).toBe('1.5k')
    expect(fmtCount(23_000)).toBe('23k')
  })

  it('renders millions with an M suffix', () => {
    expect(fmtCount(1_000_000)).toBe('1M')
    expect(fmtCount(2_500_000)).toBe('2.5M')
  })

  it('trims a trailing .0', () => {
    expect(fmtCount(2_000)).toBe('2k')
    expect(fmtCount(3_000_000)).toBe('3M')
  })
})

describe('fmtBytes', () => {
  it('renders sub-KB values in bytes', () => {
    expect(fmtBytes(0)).toBe('0 B')
    expect(fmtBytes(1023)).toBe('1023 B')
  })

  it('renders KB at the 1024 boundary', () => {
    expect(fmtBytes(1024)).toBe('1.0 KB')
    expect(fmtBytes(1536)).toBe('1.5 KB')
    expect(fmtBytes(1024 * 1024 - 1)).toBe('1024.0 KB')
  })

  it('renders MB at the 1024*1024 boundary', () => {
    expect(fmtBytes(1024 * 1024)).toBe('1.0 MB')
    expect(fmtBytes(1024 * 1024 * 2.5)).toBe('2.5 MB')
  })
})

describe('relativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-02T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns empty string for an empty input', () => {
    expect(relativeTime('')).toBe('')
  })

  it('returns "today" for under a minute', () => {
    expect(relativeTime('2026-07-02T11:59:30.000Z')).toBe('today')
  })

  it('renders minutes ago', () => {
    expect(relativeTime('2026-07-02T11:55:00.000Z')).toBe('5m ago')
  })

  it('renders hours ago', () => {
    expect(relativeTime('2026-07-02T09:00:00.000Z')).toBe('3h ago')
  })

  it('renders days ago', () => {
    expect(relativeTime('2026-06-29T12:00:00.000Z')).toBe('3d ago')
  })

  it('renders months ago', () => {
    expect(relativeTime('2026-04-02T12:00:00.000Z')).toBe('3mo ago')
  })

  it('renders years ago', () => {
    expect(relativeTime('2024-07-02T12:00:00.000Z')).toBe('2y ago')
  })
})

// A world save and a full-server backup zip are routinely gigabytes. Without a
// GB tier the Overview panel renders "4096.0 MB", which is why this one exists.
describe('fmtBytes at gigabyte scale', () => {
  const GB = 1024 ** 3

  it('switches to GB at exactly one gigabyte', () => {
    expect(fmtBytes(GB - 1)).toBe('1024.0 MB')
    expect(fmtBytes(GB)).toBe('1.00 GB')
  })

  it('keeps two decimals, so 4.25 GB does not read as 4.2', () => {
    expect(fmtBytes(4.25 * GB)).toBe('4.25 GB')
    expect(fmtBytes(12 * GB)).toBe('12.00 GB')
  })
})

describe('relativeMs / untilMs', () => {
  const NOW = new Date('2026-07-02T12:00:00.000Z')
  const MIN = 60_000
  const HOUR = 60 * MIN

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads a past timestamp backwards', () => {
    expect(relativeMs(NOW.getTime() - 30_000)).toBe('just now')
    expect(relativeMs(NOW.getTime() - 12 * MIN)).toBe('12m ago')
    expect(relativeMs(NOW.getTime() - 3 * HOUR)).toBe('3h ago')
    expect(relativeMs(NOW.getTime() - 50 * HOUR)).toBe('2d ago')
  })

  it('reads a future timestamp forwards', () => {
    expect(untilMs(NOW.getTime() + 5 * MIN)).toBe('in 5m')
    expect(untilMs(NOW.getTime() + 6 * HOUR)).toBe('in 6h')
    expect(untilMs(NOW.getTime() + 72 * HOUR)).toBe('in 3d')
  })

  // A next-run time the backend has not recomputed yet is in the past, and
  // "in -4m" would be worse than useless on a countdown.
  it('says now rather than counting backwards once a run time has passed', () => {
    expect(untilMs(NOW.getTime() - MIN)).toBe('now')
    expect(untilMs(NOW.getTime())).toBe('now')
  })

  // untilMs rounds where relativeMs floors: a countdown reading "in 59m" when
  // it is 59 minutes 40 seconds out is precise about the wrong thing.
  it('rounds the countdown to the coarser unit', () => {
    expect(untilMs(NOW.getTime() + 59.7 * MIN)).toBe('in 1h')
    expect(relativeMs(NOW.getTime() - 59.7 * MIN)).toBe('59m ago')
  })
})

// Both epoch-ms helpers treat 0 as "never" rather than as 1970. A world that
// was never played has lastPlayed 0 (Go's zero value for an int64), and
// relativeMs(0) used to render as twenty thousand days ago; the Worlds HUD
// carried its own wrapper for exactly that, and the player popup its own date
// formatter with the same guard (#260).
describe('epoch zero means never', () => {
  it('renders a dash for 0', () => {
    expect(relativeMs(0)).toBe('—')
    expect(fmtDate(0)).toBe('—')
  })
})

describe('fmtDate', () => {
  // One toLocaleString call with both option sets, so the separator between
  // date and time is the locale's own rather than a hand-joined space. The
  // exact text depends on the runtime locale; what is pinned is that it is
  // the single-call form, which is the reconciliation the two copies needed.
  it('formats date and time in one locale call', () => {
    const ms = Date.UTC(2026, 6, 2, 12, 34)
    expect(fmtDate(ms)).toBe(
      new Date(ms).toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    )
    expect(fmtDate(ms)).toMatch(/2026/)
  })
})
