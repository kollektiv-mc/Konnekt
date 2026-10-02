/**
 * Shared helpers for handling Wails IPC rejections in stores and hooks.
 *
 * These exist because a rejection means two very different things depending on
 * where the app is running, and a store that cannot tell them apart has to pick
 * one and be wrong half the time.
 */

/** Wails rejects with plain strings as often as with Errors. */
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Whether a Wails backend is attached at all.
 *
 * The generated bindings dereference `window.go` directly
 * (`frontend/wailsjs/go/main/App.js`), so with no bridge every call throws
 * `TypeError` synchronously rather than rejecting for a backend reason. That is
 * the `frontend-dev` preset in `.claude/launch.json`: a browser-only Vite server
 * with no Go process behind it, used to look at the UI.
 *
 * Write actions branch on this. With no bridge nothing was ever going to be
 * persisted and the user is not being misled, so the optimistic update stands
 * and the preview stays usable. With a bridge present, a rejection is a real
 * failed write: revert it, record the message, rethrow.
 *
 * This reads `window.go`'s *presence* and never calls through it, so
 * `agent_docs/CLAUDE.md`'s "IPC via generated bindings only" rule still holds.
 */
export function hasWailsBridge(): boolean {
  return typeof window !== 'undefined' && 'go' in window
}

/**
 * Whether this page is the dashboard served to a browser by the Remote Access
 * listener (#44), as opposed to the desktop WebView, the browser demo or the
 * `frontend-dev` preset. `main.tsx` asks it before React mounts, to decide
 * whether `lib/remoteRuntime.ts` has to install `window.go` first.
 *
 * It is a production build with no bridge, and each other case reads
 * correctly for its own reason:
 *
 * - Desktop: Wails injects `/wails/runtime.js` as a classic script at the top
 *   of `<head>`, and that sets `window.go = {}` synchronously, so the bridge
 *   is present before `main.tsx` runs even though no binding has been called.
 * - Demo: `demo/build.mjs` inserts its shim as a module script ahead of the
 *   app's, and module scripts run in document order, so it has set
 *   `window.go` by then.
 * - `frontend-dev`: Vite's dev server, so `import.meta.env.PROD` is false.
 *
 * `vite preview` of a production build has no bridge either and reads as
 * remote. That is acceptable: it is the same bundle with no Go behind it, and
 * the gate it lands on says so.
 *
 * The answer has to stay true after `lib/remoteRuntime.ts` has installed its
 * own `window.go`, because components ask at render time, long after boot:
 * the title bar to drop the window buttons, Settings to drop what only the
 * desktop can do. "No bridge" stops being true the moment the runtime exists,
 * so the runtime marks the `window.go` it installs and that mark is read here.
 */
export function isRemoteBrowser(): boolean {
  if (!import.meta.env.PROD) return false
  if (!hasWailsBridge()) return true
  const go: unknown = Reflect.get(window, 'go')
  return typeof go === 'object' && go !== null && Reflect.get(go, REMOTE_MARK) === true
}

/** The property `lib/remoteRuntime.ts` sets on the `window.go` it installs. */
export const REMOTE_MARK = 'konnektRemote'

/**
 * Run a bound read, falling back to `fallback` however it fails.
 *
 * Same root cause as `hasWailsBridge()`, from the other side. Because the
 * generated bindings dereference `window.go` synchronously, a call with no
 * bridge throws before a promise exists, so a trailing `.catch()` is attached
 * to nothing and the throw escapes. In an effect that reaches the nearest error
 * boundary: opening Settings in the browser-only `frontend-dev` preset used to
 * unmount the whole app on `GetAppVersion()`, past a `.catch()` that read as if
 * it handled exactly this.
 *
 * Awaiting inside the wrapper turns that synchronous throw into a rejection, so
 * one handler covers it and a real backend failure alike — which is what reads
 * want, since both mean the same thing to them: no value, show the unavailable
 * state. Writes still branch on `hasWailsBridge()`, because there the two cases
 * mean different things.
 */
export async function readOr<T, F>(call: () => Promise<T>, fallback: F): Promise<T | F> {
  try {
    return await call()
  } catch {
    // aislop-ignore-next-line ai-slop/hidden-fallback -- the sanctioned no-bridge read path, see agent_docs/CLAUDE.md IPC conventions
    return fallback
  }
}
