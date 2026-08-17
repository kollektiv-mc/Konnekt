interface PopoverProps {
  open: boolean
  onClose: () => void
  width?: number | string
  maxHeight?: number
  align?: 'left' | 'right'
  children: React.ReactNode
}

export function Popover({
  open,
  onClose,
  width = 160,
  maxHeight,
  align = 'right',
  children,
}: PopoverProps) {
  const alignClass = align === 'left' ? 'left-0 origin-top-left' : 'right-0 origin-top-right'
  return (
    <>
      {open && <div className="fixed inset-0 z-[200]" onClick={onClose} />}
      <div
        className={`border-border-subtle bg-elevated border-hairline absolute top-[calc(100%_+_4px)] z-[201] overflow-hidden rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.3)] backdrop-blur-md ${alignClass}`}
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
