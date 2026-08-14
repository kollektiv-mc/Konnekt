import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fmtCount, fmtBytes, relativeTime, truncateStart } from './format'

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
