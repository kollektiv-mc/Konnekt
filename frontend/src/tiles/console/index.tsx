import { useEffect, useRef, useCallback, useMemo } from 'react'
import { SendCommand } from '../../../wailsjs/go/main/App'
import { useConsoleStore } from '../../stores/useConsoleStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useServerStore } from '../../stores/useServerStore'
import { errMsg } from '../../lib/ipc'
import { Segmented } from '../../components/ui/Segmented'
import { QuickCommandsPanel } from '../../components/QuickCommandsPanel'
import type { TileProps } from '../../types'
import type { LogLine, ManagerOutcome } from '../../stores/useConsoleStore'
import { useState } from 'react'

// Server output only. Konnekt's own narration (#113) does not take a level
// class at all: it renders as its own block below.
const LEVEL_CLASS: Record<Exclude<LogLine['level'], 'manager'>, string> = {
  success: 'text-accent',
  warn: 'text-yellow-400',
  error: 'text-red-400',
  dim: 'text-[var(--text-secondary)]',
}

// Konnekt's narration is boxed rather than merely tinted. A differently
// coloured line is easy to scroll straight past in a thousand lines of server
// output, and an outlined block with a status dot is not; the block is also
// what lets the line drop the "[Konnekt] " text tag it used to carry, since
// the box already says who is speaking.
//
// The dot says how the work went, which the tag never did. Its colours are the
// status tokens from Settings > Appearance, so narration retints with the rest
// of the app and follows the light theme's darker variants — unlike the raw
// text-sky-400 this replaced, which sat outside the token layer entirely.
const OUTCOME_STYLE: Record<ManagerOutcome, { block: string; dot: string; label: string }> = {
  progress: {
    block: 'border-warning/40 bg-warning/[0.07]',
    dot: 'bg-warning',
    label: 'Konnekt, in progress',
  },
  ok: {
    block: 'border-success/40 bg-success/[0.07]',
    dot: 'bg-success',
    label: 'Konnekt, finished',
  },
  failed: {
    block: 'border-danger/40 bg-danger/[0.07]',
    dot: 'bg-danger',
    label: 'Konnekt, failed',
  },
}

// w-fit keeps the block the width of what it says rather than a full-width
// band: a run of them (a backup narrates up to five) reads as discrete blocks
// inset in the stream instead of banding the panel. max-w-full is what lets a
// long line still wrap inside the box.
function ManagerLine({
  line,
  query,
  showTimestamp,
}: {
  line: LogLine
  query: string
  showTimestamp: boolean
}) {
  const style = OUTCOME_STYLE[line.outcome ?? 'progress']
  return (
    <div
      className={`border-hairline my-1 flex w-fit max-w-full items-start gap-2 rounded-md px-2 py-1 ${style.block}`}
    >
      {showTimestamp && <span className="text-text-faint h-5 shrink-0">{line.timestamp}</span>}
      {/* The dot is the only thing naming the outcome and it sits in no
          labelled control, so it is named rather than aria-hidden. The h-5 box
          matches leading-5, which centres it on the first line however far the
          text wraps — no magic offset to re-tune when the type scale moves. */}
      <span className="flex h-5 shrink-0 items-center">
        <span
          role="img"
          aria-label={style.label}
          className={`h-1.5 w-1.5 rounded-full ${style.dot}`}
        />
      </span>
      <span className="text-text-primary min-w-0 flex-1">{highlightQuery(line.text, query)}</span>
    </div>
  )
}

type LevelFilter = 'all' | 'warn' | 'error'

const LEVEL_FILTER_OPTIONS: { value: LevelFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
]

function highlightQuery(text: string, query: string) {
  if (!query) return <span>{text}</span>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <span>{text}</span>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-accent text-canvas rounded-sm">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  )
}

export function ConsoleTile({ serverId, maximized }: TileProps) {
  const lines = useConsoleStore((s) => s.lines)
  const clear = useConsoleStore((s) => s.clear)
  const showTimestamps = useSettingsStore((s) => s.settings.consoleTimestamps)
  const quickCommandsCollapsed = useSettingsStore((s) => s.settings.consoleQuickCommandsCollapsed)
  const updateSettings = useSettingsStore((s) => s.update)
  const [input, setInput] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [filterOpen, setFilterOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const [sendError, setSendError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const running = useServerStore((s) => s.status.running)
  const reachable = useServerStore((s) => s.reachable)
  // A stopped server and an unreachable backend both mean "this console cannot
  // take a command", but they are different sentences to put on screen.
  const acceptsCommands = reachable && running

  const filtered = useMemo(() => {
    let result = lines
    if (levelFilter !== 'all') result = result.filter((l) => l.level === levelFilter)
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      result = result.filter((l) => l.text.toLowerCase().includes(q))
    }
    return result
  }, [lines, levelFilter, query])

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [filtered, autoScroll])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }, [])

  // A rejected command used to vanish into `.catch(console.error)`, so a typo'd
  // or unroutable command looked identical to one the server had accepted and
  // simply not replied to.
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!input.trim() || !acceptsCommands) return
      const command = input.trim()
      setSendError(null)
      SendCommand(serverId, command).catch((err: unknown) => {
        setSendError(errMsg(err))
        // Put the command back so it can be retried without retyping.
        setInput(command)
      })
      setInput('')
    },
    [input, serverId, acceptsCommands],
  )

  const consoleColumn = (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* Search / filter toolbar — collapsed by default */}
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2 pb-1">
        <button
          onClick={() => setFilterOpen((v) => !v)}
          className={`flex shrink-0 items-center gap-1 font-mono text-xs transition-colors ${
            filterOpen ? 'text-text-secondary' : 'text-text-faint'
          }`}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.color = filterOpen
              ? 'var(--text-secondary)'
              : 'var(--text-faint)'
          }}
        >
          <span>{filterOpen ? '▾' : '▸'}</span>
          <span>{filterOpen ? 'Filter' : levelFilter !== 'all' ? levelFilter : 'All'}</span>
        </button>
        {filterOpen && (
          <>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search…"
              className="bg-hover border-border-subtle text-text-primary border-hairline flex-1 rounded px-2 py-0.5 font-mono text-xs outline-none"
              onFocus={(e) => {
                ;(e.target as HTMLInputElement).style.borderColor = 'var(--border-hover)'
              }}
              onBlur={(e) => {
                ;(e.target as HTMLInputElement).style.borderColor = 'var(--border-subtle)'
              }}
            />
            <Segmented
              options={LEVEL_FILTER_OPTIONS}
              value={levelFilter}
              onChange={setLevelFilter}
              compact
            />
            <span className="text-text-faint shrink-0 font-mono text-xs">
              {filtered.length}/{lines.length}
            </span>
          </>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-5 select-text"
      >
        {lines.length === 0 ? (
          // Was a bare empty <div>: an unreachable server, a stopped one and a
          // server that simply has not logged anything yet all rendered as a
          // blank panel (HEALTH_LOG.md, 2026-08-20).
          <div className="text-text-faint py-2 font-mono text-xs">
            {!reachable
              ? 'Server unreachable — no output.'
              : running
                ? 'Waiting for output…'
                : 'Server offline — start it to see output.'}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-text-faint py-2 font-mono text-xs">No matching lines</div>
        ) : (
          filtered.map((line) =>
            line.level === 'manager' ? (
              <ManagerLine key={line.id} line={line} query={query} showTimestamp={showTimestamps} />
            ) : (
              <div key={line.id} className="flex gap-2">
                {showTimestamps && (
                  <span className="text-text-faint shrink-0">{line.timestamp}</span>
                )}
                <span className={LEVEL_CLASS[line.level]}>{highlightQuery(line.text, query)}</span>
              </div>
            ),
          )
        )}
      </div>

      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true)
            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
          }}
          className="text-text-muted mx-3 mb-1 text-center text-xs transition-colors"
        >
          ↓ scroll to bottom
        </button>
      )}

      {sendError && (
        <div role="alert" className="text-danger mx-3 mb-1 font-mono text-xs">
          Command failed: {sendError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2 px-3 pt-1 pb-3">
        <span className="text-accent self-center font-mono text-sm">&gt;</span>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!acceptsCommands}
          aria-label="Server command"
          placeholder={acceptsCommands ? 'Enter command...' : 'Server offline'}
          className="bg-hover border-border-subtle text-text-primary border-hairline flex-1 rounded px-2 py-1 font-mono text-sm transition-colors outline-none disabled:opacity-40"
          onFocus={(e) => {
            ;(e.target as HTMLInputElement).style.borderColor = 'var(--border-hover)'
          }}
          onBlur={(e) => {
            ;(e.target as HTMLInputElement).style.borderColor = 'var(--border-subtle)'
          }}
        />
        <button
          type="submit"
          disabled={!acceptsCommands}
          title={acceptsCommands ? undefined : 'The server is not running'}
          className="border-border-subtle text-text-secondary border-hairline rounded px-3 py-1 text-xs transition-colors disabled:opacity-40"
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'
            ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-hover)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
            ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-subtle)'
          }}
        >
          Send
        </button>
        <button
          type="button"
          onClick={clear}
          className="border-border-subtle text-text-faint border-hairline rounded px-3 py-1 text-xs transition-colors"
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
            ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-hover)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-faint)'
            ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-subtle)'
          }}
          title="Clear console"
        >
          clr
        </button>
      </form>
    </div>
  )

  if (!maximized) return consoleColumn

  return (
    <div className="flex h-full min-h-0">
      {consoleColumn}
      {quickCommandsCollapsed ? (
        <button
          onClick={() => updateSettings({ consoleQuickCommandsCollapsed: false }).catch(() => {})}
          className="border-border-subtle text-text-faint hover:text-text-secondary border-l-hairline flex w-6 shrink-0 items-center justify-center transition-colors"
          title="Show quick commands"
        >
          <span className="font-mono text-[11px] select-none">‹</span>
        </button>
      ) : (
        <div className="border-border-subtle border-l-hairline flex w-56 shrink-0 flex-col">
          <div className="border-border-subtle border-b-hairline flex shrink-0 items-center justify-between px-3 py-2">
            <span className="text-text-secondary font-title text-xs font-medium">Commands</span>
            <button
              onClick={() =>
                updateSettings({ consoleQuickCommandsCollapsed: true }).catch(() => {})
              }
              className="text-text-faint hover:text-text-secondary text-xs transition-colors"
              title="Hide quick commands"
            >
              ›
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <QuickCommandsPanel serverId={serverId} columns={1} />
          </div>
        </div>
      )}
    </div>
  )
}
