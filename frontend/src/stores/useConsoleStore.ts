import { create } from 'zustand'
import { useSettingsStore } from './useSettingsStore'

export interface LogLine {
  id: number
  timestamp: string
  text: string
  level: 'success' | 'warn' | 'error' | 'dim' | 'manager'
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
// it — the pattern matching above is for server output, and "[Konnekt] Backup
// failed: ..." would otherwise read as a server error.
function levelFor(text: string, source?: string): LogLine['level'] {
  return source === 'manager' ? 'manager' : classifyLine(text)
}

interface ConsoleStore {
  lines: LogLine[]
  appendLine: (timestamp: string, text: string, source?: string) => void
  batchAppend: (incoming: Array<{ timestamp: string; line: string; source?: string }>) => void
  loadHistory: (lines: Array<{ timestamp: string; line: string; source?: string }>) => void
  clear: () => void
}

export const useConsoleStore = create<ConsoleStore>((set) => ({
  lines: [],
  appendLine: (timestamp, text, source) =>
    set((s) => {
      const max = useSettingsStore.getState().settings.consoleBufferLines || 1000
      return {
        lines: [
          ...s.lines.slice(-(max - 1)),
          { id: ++lineId, timestamp, text, level: levelFor(text, source) },
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
        })),
      }
    }),
  clear: () => set({ lines: [] }),
}))
