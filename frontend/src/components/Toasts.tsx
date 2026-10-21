import { useLayoutEffect, useRef, useState } from 'react'
import type { Ref } from 'react'
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
  cardRef,
}: {
  toast: Toast
  leaving: boolean
  onDismiss: () => void
  onLeft: () => void
  cardRef: Ref<HTMLDivElement>
}) {
  const tone = TONE[toast.tone]
  const icon = toast.category === 'update' ? CircleArrowUp : tone.icon
  return (
    <div
      ref={cardRef}
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

// The standard motion token, read where the browser resolves it so the glide
// keeps time with the slide and the fade in style.css.
function panelMotion(): KeyframeAnimationOptions {
  const style = getComputedStyle(document.documentElement)
  return {
    duration: parseFloat(style.getPropertyValue('--duration-panel')) || 0,
    easing: style.getPropertyValue('--ease-standard').trim() || 'ease-in-out',
    // Added to the card's own slide or fade rather than replacing it, so a
    // card still sliding in when the stack moves keeps sliding.
    composite: 'add',
  }
}

// How far a glide still running has the card from where layout puts it.
function glideOffset(el: HTMLElement, glide: Animation | undefined): number {
  if (glide?.playState !== 'running' || typeof DOMMatrixReadOnly === 'undefined') return 0
  return new DOMMatrixReadOnly(getComputedStyle(el).transform).m42
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

  // The stack glides rather than jumps when a card arrives below the others or
  // one leaves from among them: each card that layout moved is drawn where it
  // was and eased to where it now is. Measured from the column's bottom, which
  // is where it is anchored, so the "Dismiss all" row appearing above moves
  // nothing; offsetTop ignores transforms, so a card mid-glide measures where
  // layout has it and the glide still running is added on top.
  const column = useRef<HTMLElement>(null)
  const cards = useRef(new Map<number, HTMLDivElement>())
  const fromBottom = useRef(new Map<number, number>())
  const glides = useRef(new Map<number, Animation>())
  const contentHeight = useRef<number | undefined>(undefined)
  const settle = useRef<Animation | undefined>(undefined)
  useLayoutEffect(() => {
    const col = column.current
    const animate = !reducedMotion()
    // The column clips (it scrolls past its max height), and shrinks the moment
    // a card goes, while the card above is still drawn where it was: its top
    // half was cut off on the way down. So the column lets go of the height at
    // the pace of the glide, as padding above the cards: being anchored at the
    // bottom, the padding moves nothing, and the gliding card stays inside it.
    if (col) {
      const padding = parseFloat(getComputedStyle(col).paddingTop) || 0
      const content = col.scrollHeight - padding
      const shrank = (contentHeight.current ?? content) - content
      contentHeight.current = content
      if (animate && shrank > 0.5 && typeof col.animate === 'function') {
        settle.current?.cancel()
        settle.current = col.animate(
          [{ paddingTop: `${padding + shrank}px` }, { paddingTop: '0px' }],
          { ...panelMotion(), composite: 'replace' },
        )
      }
    }
    // Read after the padding starts, which every offsetTop below includes.
    const height = col?.scrollHeight ?? 0
    const next = new Map<number, number>()
    for (const [id, el] of cards.current) {
      const now = height - el.offsetTop
      next.set(id, now)
      const before = fromBottom.current.get(id)
      if (before === undefined || !animate || typeof el.animate !== 'function') continue
      const dy = now - before + glideOffset(el, glides.current.get(id))
      if (Math.abs(dy) < 0.5) continue
      glides.current.get(id)?.cancel()
      glides.current.set(
        id,
        el.animate(
          [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
          panelMotion(),
        ),
      )
    }
    fromBottom.current = next
    for (const id of glides.current.keys()) if (!next.has(id)) glides.current.delete(id)
  })
  const cardRef = (id: number) => (el: HTMLDivElement | null) => {
    if (el) cards.current.set(id, el)
    else cards.current.delete(id)
  }

  if (shown.length === 0) return null
  return (
    <section
      ref={column}
      aria-label="Notifications"
      // Flush with the window's right edge, padded off it, and clipped across:
      // a card sliding in from past that edge would otherwise overflow the
      // column sideways, and the horizontal scrollbar that brings lifted the
      // card for the length of the slide, so it dropped a pixel or two on
      // landing.
      className="z-toast pointer-events-none fixed right-0 bottom-3 box-content flex max-h-[calc(100vh_-_4rem)] w-96 max-w-[calc(100vw_-_1.5rem)] flex-col gap-2 overflow-x-hidden overflow-y-auto pr-3"
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
          cardRef={cardRef(toast.id)}
        />
      ))}
    </section>
  )
}
