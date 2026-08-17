import { useProcessesStore } from '../stores/useProcessesStore'

export function ActiveProcesses() {
  const processes = useProcessesStore((s) => s.processes)
  const list = Object.values(processes)
  if (list.length === 0) return null

  return (
    <div className="border-border-subtle border-t-hairline flex shrink-0 flex-col gap-2 px-3 py-2">
      {list.map((p) => (
        <div key={p.id} className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-1">
            <span className="text-text-muted truncate font-mono text-xs">{p.label}</span>
            <span
              className={`shrink-0 font-mono text-xs ${p.status === 'failed' ? 'text-danger' : 'text-text-faint'}`}
            >
              {p.status === 'running'
                ? p.indeterminate
                  ? '…'
                  : `${p.percent}%`
                : p.status === 'done'
                  ? '✓'
                  : '✗'}
            </span>
          </div>
          {/* An indeterminate process holds percent at 0 while it runs, so the bar
              reads empty until finish() sets it to 100 — never a full bar for work
              whose progress we cannot actually measure. */}
          <div className="bg-border-subtle h-0.5 w-full overflow-hidden rounded-full">
            <div
              className={`h-full transition-all duration-300 ${p.status === 'failed' ? 'bg-danger' : 'bg-accent'}`}
              // eslint-disable-next-line no-restricted-syntax -- percent-width progress bar fill, genuinely dynamic per-process value
              style={{ width: `${p.percent}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
