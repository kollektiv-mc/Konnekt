import { useState, useEffect, useRef, useCallback } from 'react'
import type { ModProject } from './useMods'

// Animation timing constants
const PANEL_DURATION = 280 // ms — detail panel slide
const CARD_ANIM = 130 // ms — tile fade+scale for panel open/close & initial load
const EXIT_MS = 160 // per-tile exit duration
const ENTER_MS = 140 // per-tile enter duration
const COL_DELAY = 22 // stagger step per column (ms) — subtle sweep

// Per-tile CSS driven by the current animation phase.
//   idle  — panel open/close & initial load (scale from centre, random delay)
//   exit  — page turn out: tiles fly toward the leading edge, leading column first
//   enter — page turn in:  tiles fly in from the trailing edge, trailing column first
//
// forward (next page): exit LEFT, enter from RIGHT — left col first on exit, right col first on enter
// backward (prev page): exit RIGHT, enter from LEFT — right col first on exit, left col first on enter
export function getTileStyle(
  idleDelay: number,
  col: number,
  numCols: number,
  phase: 'idle' | 'exit' | 'enter',
  gridVisible: boolean,
  direction: 'forward' | 'backward',
): React.CSSProperties {
  if (phase === 'exit') {
    // Forward: sweep left-to-right (left col exits first), tiles slide left
    // Backward: sweep right-to-left (right col exits first), tiles slide right
    const delay = direction === 'forward' ? col * COL_DELAY : (numCols - 1 - col) * COL_DELAY
    const tx = direction === 'forward' ? '-16px' : '16px'
    return {
      opacity: 0,
      transform: `scale(0.9) translateX(${tx})`,
      transition: `opacity ${EXIT_MS}ms ease ${delay}ms, transform ${EXIT_MS}ms ease ${delay}ms`,
    }
  }

  if (phase === 'enter') {
    // Forward: enter from right (right col enters first), sweep right-to-left
    // Backward: enter from left (left col enters first), sweep left-to-right
    const delay = direction === 'forward' ? (numCols - 1 - col) * COL_DELAY : col * COL_DELAY
    const tx = direction === 'forward' ? '16px' : '-16px'
    return {
      opacity: gridVisible ? 1 : 0,
      transform: gridVisible ? 'none' : `scale(0.9) translateX(${tx})`,
      transition: gridVisible
        ? `opacity ${ENTER_MS}ms ease ${delay}ms, transform ${ENTER_MS}ms ease ${delay}ms`
        : 'none',
    }
  }

  // idle — covers panel open/close, initial load, and grid reflow (all unified)
  return {
    opacity: gridVisible ? 1 : 0,
    transform: gridVisible ? 'none' : 'scale(0.95)',
    transition: `opacity ${CARD_ANIM}ms ease, transform ${CARD_ANIM}ms ease`,
    transitionDelay: gridVisible ? `${idleDelay}ms` : '0ms',
  }
}

interface Options {
  results: ModProject[]
  total: number
  loading: boolean
  panelOpen: boolean
  containerRef: React.RefObject<HTMLDivElement | null>
  // Called with the offset when a page turn fires; should trigger a new search
  onSearch: (offset: number) => void
}

interface GridPageAnimation {
  displayResults: ModProject[]
  displayTotal: number
  numCols: number
  gridVisible: boolean
  layoutOpen: boolean
  pagePhase: 'idle' | 'exit' | 'enter'
  pageDirection: 'forward' | 'backward'
  getTileDelay: (id: string) => number
  handlePage: (offset: number) => void
}

export function useGridPageAnimation({
  results,
  total,
  loading,
  panelOpen,
  containerRef,
  onSearch,
}: Options): GridPageAnimation {
  // Keep onSearch stable without requiring callers to memoize
  const onSearchRef = useRef(onSearch)
  onSearchRef.current = onSearch

  const reflowTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // ── Buffered results: hold old page during exit, swap in on commit ──────────
  const [displayResults, setDisplayResults] = useState<ModProject[]>(results)
  const [displayTotal, setDisplayTotal] = useState(total)

  // ── Per-tile idle animation delays — fresh random values each results load ───
  const tileDelaysRef = useRef<Record<string, number>>({})
  useEffect(() => {
    tileDelaysRef.current = {}
  }, [displayResults])
  const getTileDelay = useCallback((id: string) => {
    if (!(id in tileDelaysRef.current)) {
      tileDelaysRef.current[id] = Math.round(Math.random() * 55)
    }
    return tileDelaysRef.current[id]
  }, [])

  // ── Page-turn phase ─────────────────────────────────────────────────────────
  // Stable wrappers keep refs in sync at call-time. ResizeObserver callbacks can
  // fire between React commit and useEffect, so refs must be updated eagerly.
  const [pagePhase, _setPagePhase] = useState<'idle' | 'exit' | 'enter'>('idle')
  const pagePhaseRef = useRef<'idle' | 'exit' | 'enter'>('idle')
  const setPagePhase = useCallback((p: 'idle' | 'exit' | 'enter') => {
    pagePhaseRef.current = p
    _setPagePhase(p)
  }, [])

  // ── Column count (measured from container width for accurate stagger) ───────
  const [numCols, setNumCols] = useState(4)
  const numColsRef = useRef(4)

  // ── Page-turn direction ──────────────────────────────────────────────────────
  const [pageDirection, setPageDirection] = useState<'forward' | 'backward'>('forward')
  const pageDirectionRef = useRef<'forward' | 'backward'>('forward')
  const currentOffsetRef = useRef(0)

  // ── Page-turn coordination refs ─────────────────────────────────────────────
  // Both the exit-animation timer AND the network response must complete before
  // we swap in new results and start the enter animation.
  const exitDoneRef = useRef(false)
  const resultsDoneRef = useRef(false)
  const inPageTransRef = useRef(false)
  const pendingRef = useRef<{ results: ModProject[]; total: number } | null>(null)
  const transTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const prevLoadingRef = useRef(loading)

  // ── Detail panel ─────────────────────────────────────────────────────────────
  const [layoutOpen, setLayoutOpen] = useState(false)
  const [gridVisible, _setGridVisible] = useState(false)
  const gridVisibleRef = useRef(false)
  const setGridVisible = useCallback((v: boolean) => {
    gridVisibleRef.current = v
    _setGridVisible(v)
  }, [])
  const hasOpenedRef = useRef(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cardAnimTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // ── Measure column count; animate reflow when tiles are visible ──────────────
  // Mount-only: panel open/close handlers update numCols themselves (in a double-rAF
  // while tiles are hidden) so the observer never sees a stale mismatch after panel
  // transitions — preventing the double-animation from Issue 1.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => Math.max(1, Math.floor((el.getBoundingClientRect().width - 16) / 208))

    // Seed initial value — tiles are hidden at mount so no animation needed.
    const init = measure()
    setNumCols(init)
    numColsRef.current = init

    const obs = new ResizeObserver(() => {
      const cols = measure()
      if (cols === numColsRef.current) return

      if (!gridVisibleRef.current || pagePhaseRef.current !== 'idle') {
        // Tiles hidden or page-turning: update numCols silently (reflow is invisible).
        setNumCols(cols)
        numColsRef.current = cols
        return
      }

      // Tiles visible and stable: animate — hide first so the CSS reflow is invisible.
      clearTimeout(reflowTimerRef.current)
      setGridVisible(false)
      const target = cols
      reflowTimerRef.current = setTimeout(() => {
        setNumCols(target)
        numColsRef.current = target
        setGridVisible(true)
      }, CARD_ANIM)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, []) // mount-only — see comment above

  // ── commitEnter: swap in new results and start enter animation ───────────────
  // Called after BOTH the exit timer fires AND the network results arrive.
  const commitEnter = useCallback(() => {
    if (!exitDoneRef.current || !resultsDoneRef.current || !pendingRef.current) return
    const { results: r, total: t } = pendingRef.current
    exitDoneRef.current = false
    resultsDoneRef.current = false
    inPageTransRef.current = false
    pendingRef.current = null
    // Batch: update display data + phase. Tiles render at enter-start state (invisible, shifted right).
    setDisplayResults(r)
    setDisplayTotal(t)
    setPagePhase('enter')
    setGridVisible(false)
    // Two frames later: trigger the enter transition (start → end state).
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setGridVisible(true)
        clearTimeout(transTimerRef.current)
        transTimerRef.current = setTimeout(
          () => setPagePhase('idle'),
          ENTER_MS + numColsRef.current * COL_DELAY + 60,
        )
      }),
    )
  }, []) // stable: only uses refs and stable state setters

  // ── handlePage: kick off exit animation and fire the search ─────────────────
  const handlePage = useCallback(
    (offset: number) => {
      const dir = offset > currentOffsetRef.current ? 'forward' : 'backward'
      currentOffsetRef.current = offset
      pageDirectionRef.current = dir
      setPageDirection(dir)
      clearTimeout(transTimerRef.current)
      exitDoneRef.current = false
      resultsDoneRef.current = false
      inPageTransRef.current = true
      pendingRef.current = null
      setPagePhase('exit')
      onSearchRef.current(offset)
      // Exit timer: after all tiles have animated out, try to commit
      transTimerRef.current = setTimeout(
        () => {
          exitDoneRef.current = true
          commitEnter()
        },
        EXIT_MS + numColsRef.current * COL_DELAY + 30,
      )
    },
    [commitEnter],
  )

  // ── Sync incoming results: buffer during page turn, apply directly otherwise ─
  useEffect(() => {
    const wasLoading = prevLoadingRef.current
    prevLoadingRef.current = loading
    if (inPageTransRef.current && wasLoading && !loading) {
      // Network results just arrived during a page transition — store and try commit
      pendingRef.current = { results, total }
      resultsDoneRef.current = true
      commitEnter()
    } else if (!inPageTransRef.current) {
      // Normal update: query change, category filter, sort, initial load
      setDisplayResults(results)
      setDisplayTotal(total)
    }
  }, [loading, results, total, commitEnter])

  // ── Initial-load animation: Case A (remount with cached results) ─────────────
  useEffect(() => {
    if (results.length > 0) {
      const t = setTimeout(() => setGridVisible(true), 16)
      return () => clearTimeout(t)
    }
  }, []) // mount only

  // ── Initial-load animation: Case B (first results arrive after mount) ────────
  const prevDisplayLenRef = useRef(0)
  useEffect(() => {
    const prevLen = prevDisplayLenRef.current
    prevDisplayLenRef.current = displayResults.length
    if (prevLen === 0 && displayResults.length > 0 && !panelOpen && pagePhase === 'idle') {
      const t = setTimeout(() => setGridVisible(true), 16)
      return () => clearTimeout(t)
    }
  }, [displayResults.length]) // intentionally omit panelOpen, pagePhase

  // ── Detail panel open/close ──────────────────────────────────────────────────
  useEffect(() => {
    if (panelOpen) {
      hasOpenedRef.current = true
      clearTimeout(closeTimerRef.current)
      clearTimeout(cardAnimTimerRef.current)
      setGridVisible(false)
      cardAnimTimerRef.current = setTimeout(() => {
        setLayoutOpen(true)
        // Double-rAF: first frame React commits layoutOpen=true and browser lays out;
        // second frame the new container width is stable. Update numCols while tiles
        // are still hidden so the ResizeObserver finds no mismatch when it fires.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (containerRef.current) {
              const cols = Math.max(
                1,
                Math.floor((containerRef.current.getBoundingClientRect().width - 16) / 208),
              )
              setNumCols(cols)
              numColsRef.current = cols
            }
            setGridVisible(true)
          }),
        )
      }, CARD_ANIM)
    } else {
      if (!hasOpenedRef.current) return
      clearTimeout(cardAnimTimerRef.current)
      closeTimerRef.current = setTimeout(() => {
        setGridVisible(false)
        cardAnimTimerRef.current = setTimeout(() => {
          setLayoutOpen(false)
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              if (containerRef.current) {
                const cols = Math.max(
                  1,
                  Math.floor((containerRef.current.getBoundingClientRect().width - 16) / 208),
                )
                setNumCols(cols)
                numColsRef.current = cols
              }
              setGridVisible(true)
            }),
          )
        }, CARD_ANIM)
      }, PANEL_DURATION - CARD_ANIM)
    }
    return () => {
      clearTimeout(closeTimerRef.current)
      clearTimeout(cardAnimTimerRef.current)
    }
  }, [panelOpen])

  return {
    displayResults,
    displayTotal,
    numCols,
    gridVisible,
    layoutOpen,
    pagePhase,
    pageDirection,
    getTileDelay,
    handlePage,
  }
}
