import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { PerformanceTile } from '.'

// #209: with no history to anchor to, the maximized view anchored its time
// window on `Date.now()` — a fresh value on every render — and fed the derived
// cutoff to a setState effect keyed on it. Each render therefore scheduled the
// next, for as long as consecutive renders landed in different milliseconds.
// React's only guard for a setState-inside-useEffect loop is a development
// console.error after fifty nested updates, which resets its counter and
// carries on; the production build has no check at all. So on a server that
// has never run (the stats ticker emits no snapshot while stopped), or in the
// browser-only frontend-dev preset, maximizing Performance spun silently.
//
// Two deliberate choices in this file:
//
// - No `vi.mock` of the bindings, like tiles/noBridge.test.tsx: jsdom has no
//   `window.go`, so `readOr` yields null and history stays empty, which is the
//   whole condition. An automock would need to be told to resolve `[]`, and
//   that is one more thing that could drift.
// - No Testing Library `render`. It runs inside `act()`, which keeps flushing
//   effects until the tree goes quiet, so the loop this test exists to catch
//   would hang the test rather than fail it. Rendering through `createRoot`
//   with the act environment off lets React's real scheduler run, and a
//   bounded real-time wait turns "spins forever" into a countable number.
//
// `Date.now` is stubbed to advance on every call, which is what makes jsdom
// reproduce what Chromium shows: at jsdom's render speed the real clock often
// repeats a millisecond, and the loop ends by accident.

const LOOP_WARNING = /Maximum update depth exceeded/

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  let t = 1_700_000_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => (t += 1))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  root?.unmount()
  root = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
})

describe('PerformanceTile with empty history', () => {
  it('has no window.go, so history stays empty', () => {
    expect('go' in window).toBe(false)
  })

  it('renders the maximized view a bounded number of times, not once per tick of the clock', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    root.render(<PerformanceTile serverId="srv1" maximized />)
    await new Promise((resolve) => setTimeout(resolve, 30))

    // The mount alone does not start the loop: the effect's first setState
    // carries the value the state was initialised with, and React bails out.
    // What starts it in the app is any re-render from above — and the
    // maximize animation in Dashboard supplies several while the overlay is
    // opening. One is enough, because from then on each render schedules the
    // next. Rendering the same element again is that one parent re-render.
    root.render(<PerformanceTile serverId="srv1" maximized />)

    // Long enough for the loop, if it exists, to pass React's fifty-update
    // warning threshold many times over; short enough not to slow the suite.
    await new Promise((resolve) => setTimeout(resolve, 250))

    // Every render of the maximized view with no history reads the clock
    // once. Two renders were asked for above; nothing should follow them.
    expect(vi.mocked(Date.now).mock.calls.length).toBeLessThan(10)

    const loopWarnings = vi
      .mocked(console.error)
      .mock.calls.filter((args) => args.some((a) => typeof a === 'string' && LOOP_WARNING.test(a)))
    expect(loopWarnings).toHaveLength(0)
  })
})
