import { create } from 'zustand'
import { useSettingsStore } from './useSettingsStore'

// What a narrated line reports: work under way, work that finished, work that
// did not. Mirrors the backend's ConsoleLine.Outcome; the console tile paints
// one status dot per value, which is what the "[Konnekt] " text tag became.
export type ManagerOutcome = 'progress' | 'ok' | 'failed'

export interface LogLine {
  id: number
  timestamp: string
  text: string
  level: 'success' | 'warn' | 'error' | 'dim' | 'manager'
  // Set on manager lines only, so the level and the outcome cannot disagree.
  outcome?: ManagerOutcome
}

let lineId = 0

// Prefer the standard MC/log4j prefix "[HH:MM:SS] [thread/LEVEL]:" before
// falling back to substring heuristics for unstructured lines.
export function classifyLine(text: string): LogLine['level'] {
  const prefixMatch = text.match(/\[[\d:]+\]\s*\[.*?\/(FATAL|ERROR|WARN|INFO|DEBUG)\]/i)
  if (prefixMatch) {
    const lvl = prefixMatch[1].toUpperCase()
    if (lvl === 'FATAL' || lvl === 'ERROR') return 'error'
    if (lvl === 'WARN') return 'warn'
    // INFO / DEBUG — still check for the success special-cases
    if (/Done|joined the game/.test(text)) return 'success'
    return 'dim'
  }
  // Fallback for unstructured lines (plugin output, crash reports, etc.)
  if (/Done|joined the game/.test(text)) return 'success'
  if (/warn|Can't keep up/i.test(text)) return 'warn'
  if (/error|ERROR/.test(text)) return 'error'
  return 'dim'
}

// A line Konnekt narrated carries the backend's source marker (#113), so it
// is styled and filtered as manager output without classifyLine ever seeing
// it — the pattern matching above is for server output, and "Backup
// failed: ..." would otherwise read as a server error.
function levelFor(text: string, source?: string): LogLine['level'] {
  return source === 'manager' ? 'manager' : classifyLine(text)
}

// The outcome rides the same structural marker rather than the wording, for
// the same reason: "Backup failed: …" must not be classified by the word
// "failed" appearing in it. Server output has no outcome at all.
//
// A manager line whose outcome is missing or unrecognised falls back to
// progress — a line from a path that predates the marker, or a value a later
// backend adds. That default is deliberate: "something is happening" is the
// only honest thing to say when nothing was reported, and it never invents a
// success or a failure.
function outcomeFor(source?: string, outcome?: string): ManagerOutcome | undefined {
  if (source !== 'manager') return undefined
  if (outcome === 'ok' || outcome === 'failed') return outcome
  return 'progress'
}

// The wire shape of one line, from the log:line event and from
// GetConsoleHistory alike. Both marker keys are optional: the backend omits
// them entirely on server output.
export interface IncomingLine {
  timestamp: string
  line: string
  source?: string
  outcome?: string
}

interface ConsoleStore {
  lines: LogLine[]
  appendLine: (timestamp: string, text: string, source?: string, outcome?: string) => void
  batchAppend: (incoming: IncomingLine[]) => void
  loadHistory: (lines: IncomingLine[]) => void
  clear: () => void
}

export const useConsoleStore = create<ConsoleStore>((set) => ({
  lines: [],
  appendLine: (timestamp, text, source, outcome) =>
    set((s) => {
      const max = useSettingsStore.getState().settings.consoleBufferLines || 1000
      return {
        lines: [
          ...s.lines.slice(-(max - 1)),
          {
            id: ++lineId,
            timestamp,
            text,
            level: levelFor(text, source),
            outcome: outcomeFor(source, outcome),
          },
        ],
      }
    }),
  batchAppend: (incoming) =>
    set((s) => {
      if (incoming.length === 0) return s
      const max = useSettingsStore.getState().settings.consoleBufferLines || 1000
      const newLines = incoming.map((l) => ({
        id: ++lineId,
        timestamp: l.timestamp,
        text: l.line,
        level: levelFor(l.line, l.source),
        outcome: outcomeFor(l.source, l.outcome),
      }))
      const combined = [...s.lines, ...newLines]
      return { lines: combined.length > max ? combined.slice(-max) : combined }
    }),
  // Remote-access seam: prime the console from App.GetConsoleHistory() on
  // (re)connect. No caller yet; replaces lines wholesale, then live LOG_LINE
  // events append as normal.
  loadHistory: (history) =>
    set(() => {
      const max = useSettingsStore.getState().settings.consoleBufferLines || 1000
      return {
        lines: history.slice(-max).map((l) => ({
          id: ++lineId,
          timestamp: l.timestamp,
          text: l.line,
          level: levelFor(l.line, l.source),
          outcome: outcomeFor(l.source, l.outcome),
        })),
      }
    }),
  clear: () => set({ lines: [] }),
}))
