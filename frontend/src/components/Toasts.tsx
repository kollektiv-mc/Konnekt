import { useNotificationsStore } from '../stores/useNotificationsStore'
import type { Toast, ToastTone } from '../stores/useNotificationsStore'
import { Icon } from './ui/Icon'
import { IconButton } from './ui/IconButton'
import { CopyButton } from './settings/CopyButton'
import { QUIET_BUTTON } from './settings/controls'
import { CircleArrowUp, CircleX, Info, TriangleAlert, X, type LucideIcon } from '../lib/icons'

const TONE: Record<ToastTone, { icon: LucideIcon; text: string; edge: string }> = {
  info: { icon: Info, text: 'text-accent', edge: 'border-l-accent' },
  warn: { icon: TriangleAlert, text: 'text-warning', edge: 'border-l-warning' },
  error: { icon: CircleX, text: 'text-danger', edge: 'border-l-danger' },
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const tone = TONE[toast.tone]
  const icon = toast.category === 'update' ? CircleArrowUp : tone.icon
  return (
    <div
      // An error interrupts; everything else waits its turn.
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className={`bg-overlay border-border-subtle border-hairline border-l-thick pointer-events-auto rounded-lg px-3 py-2 ${tone.edge}`}
    >
      <div className="flex items-center gap-2">
        <Icon icon={icon} size="sm" className={tone.text} />
        <span className="text-text-primary min-w-0 flex-1 truncate text-xs" title={toast.title}>
          {toast.title}
        </span>
        {toast.count > 1 && (
          <span className="text-text-faint text-2xs shrink-0 font-mono">{toast.count} times</span>
        )}
        <span className="text-text-faint text-2xs shrink-0 font-mono">{toast.timestamp}</span>
        <IconButton title="Dismiss" onClick={onDismiss}>
          <Icon icon={X} size="sm" />
        </IconButton>
      </div>
      {/* The whole message, which is the point of the bubble: it wraps here,
          where there is room for it, and scrolls past a few lines. */}
      <p className="text-text-secondary text-2xs mt-1 max-h-40 overflow-y-auto font-mono break-words whitespace-pre-wrap select-text">
        {toast.text}
      </p>
      <div className="mt-1.5 flex justify-end">
        <CopyButton text={toast.text} />
      </div>
    </div>
  )
}

/**
 * The in-app notification bubbles, stacked in the bottom-right corner of the
 * window. Each holds the full text of a message that had no room where it was
 * raised (a scheduler run's failure beside the editor's controls, a crash,
 * an update) and stays until it is dismissed. Rendered from App, after
 * <main>, so it sits above the grid; the column itself lets the pointer
 * through, and only the cards take it.
 */
export function Toasts() {
  const toasts = useNotificationsStore((s) => s.toasts)
  const dismiss = useNotificationsStore((s) => s.dismissToast)
  const dismissAll = useNotificationsStore((s) => s.dismissAllToasts)
  if (toasts.length === 0) return null
  return (
    <section
      aria-label="Notifications"
      className="z-toast pointer-events-none fixed right-3 bottom-3 flex max-h-[calc(100vh_-_4rem)] w-96 max-w-[calc(100vw_-_1.5rem)] flex-col gap-2 overflow-y-auto"
    >
      {toasts.length > 1 && (
        <div className="pointer-events-auto flex justify-end">
          <button type="button" onClick={dismissAll} className={`${QUIET_BUTTON} bg-overlay`}>
            Dismiss all
          </button>
        </div>
      )}
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </section>
  )
}
