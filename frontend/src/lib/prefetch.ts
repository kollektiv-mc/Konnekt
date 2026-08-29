// Warms the heavy lazy-loaded tile chunks so the first time a tile is opened it
// doesn't pay a cold fetch + evaluate, and — the part the first version of this
// file got wrong — does it at a moment the user cannot feel.
//
// That first version fired a single `requestIdleCallback(warm, { timeout: 3000 })`
// which kicked off every import at once. Evaluating them is ~100ms of main
// thread, and one to three seconds after launch is exactly when the user makes
// their first scroll, so the warm-up moved the stutter off the first tile open
// and onto the first scroll instead. Measured on a 4x-throttled build: the
// first scroll lost two frames to 189ms of blocking, of which about half was
// this file. Two rules fix it — warm one chunk per idle slot so no single
// block is long, and never start one while the user is interacting.

// Every specifier here must match the `lazy()` declaration it mirrors, exactly.
// Vite keys a chunk by its resolved specifier, so a path that differs by even a
// directory hop resolves to a second copy of the module and the warm-up buys
// nothing at all. Ordered cheapest and most likely first, three.js last.
const CHUNKS: ReadonlyArray<() => Promise<unknown>> = [
  () => import('../tiles/performance/charts'),
  () => import('../tiles/scheduler/editor/GraphEditor'),
  () => import('../tiles/config/EditorPanel'),
  () => import('../tiles/mods/MarkdownBody'),
  () => import('../tiles/worlds/scene/WorldsScene'),
]

// How quiet the app has to be before another chunk is evaluated.
const QUIET_MS = 500

// Input that means a frame is about to matter. `scroll` is here because the
// canvas is the app's only scroller and scrolling it is the interaction this
// whole file exists to stay out of the way of; element `scroll` events don't
// bubble, but a capture-phase listener on `window` still sees them. Deliberately
// *not* here: `pointermove`. The pointer crossing the window on its way
// somewhere is not an interaction, and counting it as one starves the queue for
// as long as the user keeps the mouse moving.
const INPUT_EVENTS = ['wheel', 'pointerdown', 'keydown', 'scroll'] as const

// requestIdleCallback is absent from some WebView builds (and from jsdom), so
// the timeout fallback is a real code path, not a formality.
function whenIdle(fn: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => fn(), { timeout: 2000 })
  } else {
    setTimeout(fn, 200)
  }
}

/**
 * Evaluates `loaders` one at a time during idle time, deferring whenever the
 * user has interacted within the last {@link QUIET_MS}. Returns a canceller
 * that stops the queue and detaches its listeners.
 */
export function warmSequentially(loaders: ReadonlyArray<() => Promise<unknown>>): () => void {
  let cancelled = false
  // Starts at "now" rather than 0 so the first chunk always waits out one quiet
  // window: the app has just mounted and is still finishing its first paint.
  let lastInput = performance.now()

  const noteInput = () => {
    lastInput = performance.now()
  }
  for (const name of INPUT_EVENTS) {
    window.addEventListener(name, noteInput, { capture: true, passive: true })
  }

  const stop = () => {
    cancelled = true
    for (const name of INPUT_EVENTS) {
      window.removeEventListener(name, noteInput, true)
    }
  }

  let next = 0
  const step = () => {
    if (cancelled) return
    if (next >= loaders.length) {
      stop()
      return
    }
    if (performance.now() - lastInput < QUIET_MS) {
      whenIdle(step)
      return
    }
    loaders[next++]()
      .catch(() => {
        /* A chunk that fails to warm still loads normally when the tile opens. */
      })
      .then(() => whenIdle(step))
  }
  whenIdle(step)

  return stop
}

let started = false

export function prefetchHeavyChunks(): void {
  if (started) return
  started = true
  warmSequentially(CHUNKS)
}
