import { useRef, useEffect, type RefObject } from 'react'
import type { Backup } from './useBackups'
import { BackupCard } from './BackupCard'

const VISIBLE_RADIUS = 3
const SCALE_FALLOFF = 0.12
const OPACITY_FALLOFF = 0.25
const WHEEL_THRESHOLD = 40
const GAP_PX = 26 // equal gap between every adjacent card pair
const FOCUSED_W = 360 // must match BackupCard focused width
const UNFOCUSED_W = 260 // must match BackupCard unfocused width

// Visual half-width of a card at a given absolute offset, accounting for scale.
function visualHalfWidth(absOffset: number): number {
  const scale = Math.max(0.55, 1 - absOffset * SCALE_FALLOFF)
  const base = absOffset === 0 ? FOCUSED_W : UNFOCUSED_W
  return (base * scale) / 2
}

// Center X for a card at `offset` from focused, keeping GAP_PX between every adjacent pair.
function centerXForOffset(offset: number): number {
  if (offset === 0) return 0
  const sign = Math.sign(offset)
  const absOff = Math.abs(offset)
  let x = visualHalfWidth(0) + GAP_PX + visualHalfWidth(1)
  for (let k = 1; k < absOff; k++) {
    x += visualHalfWidth(k) + GAP_PX + visualHalfWidth(k + 1)
  }
  return sign * x
}

interface BackupCarouselProps {
  backups: Backup[]
  focusedIndex: number
  onFocusChange: (i: number) => void
  panelOpen: boolean
  onOpenPanel: () => void
  onClosePanel: () => void
  serverRunning: boolean
  creatingFilename: string | null
  onRequestRestore: (b: Backup) => void
  onRequestDelete: (b: Backup) => void
  wheelTargetRef?: RefObject<HTMLElement | null>
}

export function BackupCarousel({
  backups,
  focusedIndex,
  onFocusChange,
  panelOpen,
  onOpenPanel,
  onClosePanel,
  serverRunning,
  creatingFilename,
  onRequestRestore,
  onRequestDelete,
  wheelTargetRef,
}: BackupCarouselProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wheelAccum = useRef(0)
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusedIndexRef = useRef(focusedIndex)
  const backupsLengthRef = useRef(backups.length)
  const onFocusChangeRef = useRef(onFocusChange)
  const onOpenPanelRef = useRef(onOpenPanel)
  const onClosePanelRef = useRef(onClosePanel)
  const panelOpenRef = useRef(panelOpen)

  focusedIndexRef.current = focusedIndex
  backupsLengthRef.current = backups.length
  onFocusChangeRef.current = onFocusChange
  onOpenPanelRef.current = onOpenPanel
  onClosePanelRef.current = onClosePanel
  panelOpenRef.current = panelOpen

  useEffect(() => {
    const el = wheelTargetRef?.current ?? containerRef.current
    if (!el) return

    function handleWheel(e: WheelEvent) {
      e.preventDefault()
      wheelAccum.current += e.deltaY

      if (Math.abs(wheelAccum.current) >= WHEEL_THRESHOLD) {
        const direction = Math.sign(wheelAccum.current)
        wheelAccum.current = 0
        const next = Math.max(
          0,
          Math.min(backupsLengthRef.current - 1, focusedIndexRef.current + direction),
        )
        if (next !== focusedIndexRef.current) onFocusChangeRef.current(next)
      }

      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current)
      wheelTimerRef.current = setTimeout(() => {
        wheelAccum.current = 0
      }, 200)
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        const next = Math.max(0, focusedIndexRef.current - 1)
        if (next !== focusedIndexRef.current) onFocusChangeRef.current(next)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        const next = Math.min(backupsLengthRef.current - 1, focusedIndexRef.current + 1)
        if (next !== focusedIndexRef.current) onFocusChangeRef.current(next)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        onOpenPanelRef.current()
      } else if (e.key === 'ArrowUp') {
        if (!panelOpenRef.current) return
        e.preventDefault()
        onClosePanelRef.current()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const atStart = focusedIndex === 0
  const atEnd = focusedIndex === backups.length - 1

  return (
    <div ref={containerRef} className="relative h-full w-full [clip-path:inset(-300px_0_0_0)]">
      {/* Left arrow */}
      <button
        className={`absolute top-1/2 left-4 z-[150] flex h-8 w-8 -translate-y-1/2 items-center justify-center bg-transparent text-xl transition-all ${atStart ? 'text-text-faint cursor-default opacity-25' : 'text-text-secondary cursor-pointer opacity-60'}`}
        disabled={atStart}
        onClick={() => onFocusChange(Math.max(0, focusedIndex - 1))}
        onMouseEnter={(e) => {
          if (!atStart) (e.currentTarget as HTMLButtonElement).style.opacity = '1'
        }}
        onMouseLeave={(e) => {
          if (!atStart) (e.currentTarget as HTMLButtonElement).style.opacity = '0.6'
        }}
        aria-label="Previous backup"
      >
        ‹
      </button>

      {/* Right arrow */}
      <button
        className={`absolute top-1/2 right-4 z-[150] flex h-8 w-8 -translate-y-1/2 items-center justify-center bg-transparent text-xl transition-all ${atEnd ? 'text-text-faint cursor-default opacity-25' : 'text-text-secondary cursor-pointer opacity-60'}`}
        disabled={atEnd}
        onClick={() => onFocusChange(Math.min(backups.length - 1, focusedIndex + 1))}
        onMouseEnter={(e) => {
          if (!atEnd) (e.currentTarget as HTMLButtonElement).style.opacity = '1'
        }}
        onMouseLeave={(e) => {
          if (!atEnd) (e.currentTarget as HTMLButtonElement).style.opacity = '0.6'
        }}
        aria-label="Next backup"
      >
        ›
      </button>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {backups.map((backup, i) => {
          const offset = i - focusedIndex
          if (Math.abs(offset) > VISIBLE_RADIUS) return null
          const absOffset = Math.abs(offset)
          const scale = Math.max(0.55, 1 - absOffset * SCALE_FALLOFF)
          const opacity = Math.max(0.1, 1 - absOffset * OPACITY_FALLOFF)
          const tx = centerXForOffset(offset)

          return (
            <div
              key={backup.filename}
              className={`pointer-events-auto absolute ${offset !== 0 ? 'cursor-pointer' : 'cursor-default'}`}
              // eslint-disable-next-line no-restricted-syntax -- transform/opacity/zIndex are continuous values computed from carousel offset, invisible to Tailwind's static scanner
              style={{
                transform: `translateX(${tx}px) scale(${scale})`,
                opacity,
                zIndex: 100 - absOffset * 10,
                transition: 'transform 260ms cubic-bezier(0.34,1.15,0.64,1), opacity 200ms ease',
              }}
              onClick={() => {
                if (offset !== 0) onFocusChange(i)
              }}
            >
              <BackupCard
                backup={backup}
                focused={offset === 0}
                inProgress={backup.filename === creatingFilename}
                serverRunning={serverRunning}
                onRequestRestore={() => onRequestRestore(backup)}
                onRequestDelete={() => onRequestDelete(backup)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
