interface Props {
  onBackUpNow: () => void
  onStopAndBackUp: () => void
  onCancel: () => void
}

export function BackupRunningDialog({ onBackUpNow, onStopAndBackUp, onCancel }: Props) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-black/55"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="bg-surface border-border-subtle border-hairline mx-4 flex w-full max-w-xs flex-col gap-3 rounded-lg px-4 py-4">
        <p className="text-text-secondary font-mono text-xs leading-relaxed">
          The server is running. Back up now and saves will be flushed first, or stop the server
          cleanly before backing up.
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onBackUpNow}
            className="border-accent text-accent w-full rounded border bg-transparent px-3 py-1.5 font-mono text-xs transition-colors"
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.background =
                'color-mix(in srgb, var(--accent) 10%, transparent)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            }}
          >
            Back up now
          </button>
          <button
            onClick={onStopAndBackUp}
            className="border-border-hover text-text-secondary w-full rounded border bg-transparent px-3 py-1.5 font-mono text-xs transition-colors"
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--text-muted)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-hover)'
            }}
          >
            Stop server &amp; back up
          </button>
          <button
            onClick={onCancel}
            className="text-text-faint w-full px-3 py-1.5 font-mono text-xs transition-colors"
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-faint)'
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
