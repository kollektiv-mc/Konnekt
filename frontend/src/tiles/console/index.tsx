import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import { SendCommand } from '../../../wailsjs/go/main/App'
import { useConsoleStore } from '../../stores/useConsoleStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useServerStore } from '../../stores/useServerStore'
import { errMsg } from '../../lib/ipc'
import { Segmented } from '../../components/ui/Segmented'
import { Icon } from '../../components/ui/Icon'
import { IconButton } from '../../components/ui/IconButton'
import { ChevronLeft, ChevronRight } from '../../lib/icons'
import { QuickCommandsPanel } from '../../components/QuickCommandsPanel'
import type { TileProps } from '../../types'
import { foldQuiet, isFold } from '../../lib/logImportance'
import type { LogLine, ManagerOutcome } from '../../stores/useConsoleStore'

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

function LogRow({
  line,
  query,
  showTimestamps,
}: {
  line: LogLine
  query: string
  showTimestamps: boolean
}) {
  if (line.level === 'manager') {
    return <ManagerLine line={line} query={query} showTimestamp={showTimestamps} />
  }
  return (
    <div className="flex gap-2">
      {showTimestamps && <span className="text-text-faint shrink-0">{line.timestamp}</span>}
      <span className={LEVEL_CLASS[line.level]}>{highlightQuery(line.text, query)}</span>
    </div>
  )
}

/**
 * A run of quiet lines in the expanded layout: one row with the count, which
 * opens in place to show them. The count is the whole point of the row, so
 * it stays visible while the run is open, as the row's header.
 */
function QuietFoldRow({
  lines,
  open,
  onToggle,
  query,
  showTimestamps,
}: {
  lines: LogLine[]
  open: boolean
  onToggle: () => void
  query: string
  showTimestamps: boolean
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="text-text-faint hover:text-text-muted flex items-center gap-2 text-left transition-colors"
        title={open ? 'Hide these lines' : 'Show these lines'}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>
          {lines.length} {lines.length === 1 ? 'line' : 'lines'}
        </span>
      </button>
      {open && (
        <div className="border-border-subtle border-l-hairline ml-1 pl-2">
          {lines.map((line) => (
            <LogRow key={line.id} line={line} query={query} showTimestamps={showTimestamps} />
          ))}
        </div>
      )}
    </div>
  )
}

export function ConsoleTile({ serverId, maximized, layout = 'default' }: TileProps) {
  const lines = useConsoleStore((s) => s.lines)
  const clear = useConsoleStore((s) => s.clear)
  const showTimestamps = useSettingsStore((s) => s.settings.consoleTimestamps)
  const quickCommandsCollapsed = useSettingsStore((s) => s.settings.consoleQuickCommandsCollapsed)
  const updateSettings = useSettingsStore((s) => s.update)
  const [input, setInput] = useState('')
  const [autoScroll, setAutoScrollState] = useState(true)
  const [filterOpen, setFilterOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const [sendError, setSendError] = useState<string | null>(null)
  // The folds the user has opened in the expanded layout, by the fold's id
  // (its first line), so an open fold stays open as lines arrive after it.
  const [openFolds, setOpenFolds] = useState<ReadonlySet<number>>(() => new Set())
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // The tail state is mirrored into a ref written at call time, not synced in
  // an effect: a ResizeObserver callback can fire between React's commit and
  // the effect that would have updated it, so an effect-synced ref is read
  // stale exactly when the observer needs it. Same reason, same shape as
  // `tiles/mods/useGridPageAnimation.ts`.
  const autoScrollRef = useRef(true)
  const setAutoScroll = useCallback((v: boolean) => {
    autoScrollRef.current = v
    setAutoScrollState(v)
  }, [])
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

  // The expanded layout shows what matters and folds each run of chatter
  // into one row (lib/logImportance.ts); detailed shows every line at a
  // tighter leading; default is the log as it comes.
  const entries = useMemo(
    () => (layout === 'expanded' ? foldQuiet(filtered) : filtered),
    [filtered, layout],
  )
  const leading = layout === 'detailed' ? 'leading-4' : 'leading-5'

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
  }, [setAutoScroll])

  // Re-pin the tail whenever the pane's geometry changes, which the effect
  // above cannot do: its deps are the lines and the tail state, and a reflow
  // is neither.
  //
  // Log rows wrap — each is a plain `flex gap-2` with no `whitespace-nowrap` —
  // so anything that changes the pane's width changes how many rows the
  // content occupies, and with it `scrollHeight`. Collapsing the quick
  // commands rail hands this column the rail's width; resizing the tile on the
  // canvas or the window does the same thing more slowly. The browser keeps
  // `scrollTop` across that reflow, so a pane that was following the tail
  // lands short of it, and `handleScroll` then re-derives the tail state from
  // wherever it ended up. That is how following a live log got dropped with
  // nothing on screen to say so, and why the jump-to-bottom button below was
  // needed several times a session.
  //
  // A callback ref rather than an effect with a dependency array: the pane is
  // a different element in the maximized and canvas branches of this tile, so
  // an effect keyed on anything but the element itself observes a detached
  // node after a maximize. Guarded for jsdom, which has no ResizeObserver, the
  // way `hooks/useElementSize` is. Writing `scrollTop` cannot resize the
  // observed element, so there is no observer loop to fall into.
  const observerRef = useRef<ResizeObserver | null>(null)
  const attachPane = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    scrollRef.current = el
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (autoScrollRef.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(el)
    observerRef.current = observer
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
        ref={attachPane}
        onScroll={handleScroll}
        className={`min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-xs select-text ${leading}`}
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
          entries.map((entry) =>
            isFold(entry) ? (
              <QuietFoldRow
                key={`fold:${entry.id}`}
                lines={entry.lines}
                open={openFolds.has(entry.id)}
                onToggle={() =>
                  setOpenFolds((prev) => {
                    const next = new Set(prev)
                    if (next.has(entry.id)) next.delete(entry.id)
                    else next.add(entry.id)
                    return next
                  })
                }
                query={query}
                showTimestamps={showTimestamps}
              />
            ) : (
              <LogRow key={entry.id} line={entry} query={query} showTimestamps={showTimestamps} />
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
        // A full-height strip rather than an IconButton: with the rail closed
        // this edge is the only thing that reopens it, and a 24px box in the
        // middle of it would be a smaller target than the strip already is.
        <button
          type="button"
          onClick={() => updateSettings({ consoleQuickCommandsCollapsed: false }).catch(() => {})}
          className="border-border-subtle text-text-faint hover:text-text-secondary border-l-hairline flex w-6 shrink-0 items-center justify-center transition-colors"
          title="Show quick commands"
          aria-label="Show quick commands"
        >
          <Icon icon={ChevronLeft} />
        </button>
      ) : (
        <div className="border-border-subtle border-l-hairline flex w-56 shrink-0 flex-col">
          <div className="border-border-subtle border-b-hairline flex shrink-0 items-center justify-between px-3 py-2">
            <span className="text-text-secondary font-title text-xs font-medium">Commands</span>
            {/* Was a bare › at text-xs with no box: the hit target was whatever
                the glyph happened to occupy, a few pixels across, against the
                full-height strip that reopens the rail. IconButton is the box
                the rest of the app's panel controls share. */}
            <IconButton
              onClick={() =>
                updateSettings({ consoleQuickCommandsCollapsed: true }).catch(() => {})
              }
              title="Hide quick commands"
            >
              <Icon icon={ChevronRight} />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <QuickCommandsPanel serverId={serverId} columns={1} />
          </div>
        </div>
      )}
    </div>
  )
}
