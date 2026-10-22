import { useRef } from 'react'
import type { RefObject } from 'react'
import { useOutsideDismiss } from '../../hooks/useOutsideDismiss'

interface PopoverProps {
  open: boolean
  onClose: () => void
  width?: number | string
  maxHeight?: number
  align?: 'left' | 'right'
  /**
   * How a press outside closes it. `backdrop` (the default) lays a full-screen
   * layer under the panel, which eats the press that dismisses. `pointerdown`
   * has no layer: a document listener closes it and lets the press go on to
   * whatever it landed on, so a neighbouring button or the canvas works on the
   * first click. It needs `trigger`, the button that opens this, so that the
   * button's own click can close it.
   */
  dismiss?: 'backdrop' | 'pointerdown'
  trigger?: RefObject<HTMLElement | null>
  children: React.ReactNode
}

export function Popover({
  open,
  onClose,
  width = 160,
  maxHeight,
  align = 'right',
  dismiss = 'backdrop',
  trigger,
  children,
}: PopoverProps) {
  const panel = useRef<HTMLDivElement>(null)
  useOutsideDismiss(open && dismiss === 'pointerdown', onClose, [panel, trigger])
  const alignClass = align === 'left' ? 'left-0 origin-top-left' : 'right-0 origin-top-right'
  // Backdrop and panel both on z-popover: the panel is the later sibling, so
  // one value orders them (lib/layers.ts). Every Popover today lives inside a
  // tile, so the value orders it against the tile, never against an app-level
  // modal.
  return (
    <>
      {open && dismiss === 'backdrop' && (
        <div className="z-popover fixed inset-0" onClick={onClose} />
      )}
      <div
        ref={panel}
        className={`border-border-subtle bg-overlay border-hairline z-popover absolute top-[calc(100%_+_4px)] overflow-hidden rounded-lg ${alignClass}`}
        // eslint-disable-next-line no-restricted-syntax -- width prop + open-driven animation are runtime-computed, not visible to Tailwind's static scanner
        style={{
          minWidth: width,
          transform: open ? 'scaleY(1) translateY(0)' : 'scaleY(0.85) translateY(-6px)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition:
            'transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) ease',
        }}
      >
        {maxHeight ? (
          // eslint-disable-next-line no-restricted-syntax -- maxHeight is a runtime prop, not visible to Tailwind's static scanner
          <div className="overflow-y-auto" style={{ maxHeight }}>
            {children}
          </div>
        ) : (
          children
        )}
      </div>
    </>
  )
}
