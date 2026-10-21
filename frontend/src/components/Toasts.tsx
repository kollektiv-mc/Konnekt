import { useState } from 'react'
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

function ToastCard({
  toast,
  leaving,
  onDismiss,
  onLeft,
}: {
  toast: Toast
  leaving: boolean
  onDismiss: () => void
  onLeft: () => void
}) {
  const tone = TONE[toast.tone]
  const icon = toast.category === 'update' ? CircleArrowUp : tone.icon
  return (
    <div
      // An error interrupts; everything else waits its turn. A card on its way
      // out is already gone from the store, so it is hidden from assistive tech
      // and the pointer while it fades.
      role={toast.tone === 'error' ? 'alert' : 'status'}
      aria-hidden={leaving || undefined}
      onAnimationEnd={(e) => {
        // Only the card's own exit: an animation inside it bubbles here too.
        if (leaving && e.target === e.currentTarget) onLeft()
      }}
      className={`bg-overlay border-border-subtle border-hairline border-l-thick rounded-lg px-3 py-2 ${tone.edge} ${leaving ? 'toast-out pointer-events-none' : 'toast-in pointer-events-auto'}`}
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

type Shown = { toast: Toast; leaving: boolean }

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/**
 * The cards on screen: the store's bubbles, in the order they arrived, plus the
 * ones it has just let go of, kept until their exit animation ends. With
 * reduced motion there is no animation to wait for, so they go at once.
 */
function reconcileToasts(shown: Shown[], toasts: Toast[], instant: boolean): Shown[] {
  const live = new Map(toasts.map((t) => [t.id, t]))
  const next: Shown[] = []
  for (const s of shown) {
    const current = live.get(s.toast.id)
    if (current) next.push({ toast: current, leaving: false })
    else if (!instant) next.push({ toast: s.toast, leaving: true })
  }
  const known = new Set(shown.map((s) => s.toast.id))
  for (const t of toasts) if (!known.has(t.id)) next.push({ toast: t, leaving: false })
  return next
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
  // Derived during render rather than in an effect, so a new bubble is drawn
  // in the same frame the store raises it.
  const [seen, setSeen] = useState(toasts)
  const [shown, setShown] = useState(() => reconcileToasts([], toasts, true))
  if (seen !== toasts) {
    setSeen(toasts)
    setShown(reconcileToasts(shown, toasts, reducedMotion()))
  }
  const left = (id: number) => setShown((all) => all.filter((s) => s.toast.id !== id))
  if (shown.length === 0) return null
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
      {shown.map(({ toast, leaving }) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          leaving={leaving}
          onDismiss={() => dismiss(toast.id)}
          onLeft={() => left(toast.id)}
        />
      ))}
    </section>
  )
}
