import { LogClientError } from '../../wailsjs/go/main/App'
import { errMsg, hasWailsBridge } from './ipc'

/**
 * The frontend's one path into konnekt.log (#245).
 *
 * React reports a caught render error through `console.error`, and an uncaught
 * exception or an unhandled rejection goes to the WebView's console. A packaged
 * build has neither a terminal nor devtools, so until this existed a tile crash
 * the user could see on screen was still one they could not attach to a bug
 * report. `services.InitLogger` already points the backend at a file for the
 * same reason; this forwards to it through one bound method.
 *
 * `origin` names the path that caught the error: `render` for an
 * `ErrorBoundary`, `error` and `unhandledrejection` for the window listeners
 * `installGlobalErrorReporting` registers.
 */
export type ClientErrorOrigin = 'render' | 'error' | 'unhandledrejection'

/**
 * Best-effort, and deliberately so: this never throws and never rejects. A
 * logger that can fail is a second error to log, and this one runs from
 * inside error handlers.
 *
 * With no Wails bridge (the browser-only `frontend-dev` preset) there is no
 * log to reach and the generated binding would throw synchronously, so it
 * returns before touching the binding — the same `hasWailsBridge()` split
 * every write in the app uses (`lib/ipc.ts`).
 *
 * `detail` is appended to the stack: for a render error, React's component
 * stack, which is what names the tile.
 */
export function reportClientError(
  origin: ClientErrorOrigin,
  error: unknown,
  detail?: string,
): void {
  if (!hasWailsBridge()) return
  const message = errMsg(error)
  const stack = [error instanceof Error ? error.stack : undefined, detail]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('\n')
  try {
    // The empty catch is the contract stated above, not the swallowed
    // rejection `agent_docs/CLAUDE.md`'s IPC conventions warn against: there is
    // no optimistic state to revert and nobody to rethrow to.
    LogClientError(origin, message, stack).catch(() => {})
  } catch {
    // A binding that throws synchronously (no bridge after all) ends here.
  }
}

/**
 * Forward what no boundary caught: an exception that escaped to the window,
 * and a promise nobody handled — which is the shape of every binding called
 * from a click handler without a catch (#185). Registered once in `main.tsx`
 * before React mounts. Returns the uninstaller, for tests.
 *
 * React 19 routes an error no boundary caught through `reportError`, which
 * dispatches the window's `error` event, so that path lands here too; an error
 * a boundary *did* catch reaches `reportClientError` from `componentDidCatch`
 * and never fires this listener, so nothing is logged twice.
 */
export function installGlobalErrorReporting(target: Window = window): () => void {
  const onError = (e: ErrorEvent) => reportClientError('error', e.error ?? e.message)
  const onRejection = (e: PromiseRejectionEvent) =>
    reportClientError('unhandledrejection', e.reason)
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
  }
}
