import * as Bindings from '../../wailsjs/go/main/App'

/**
 * The remote half of #44: the two globals Wails would have injected, backed by
 * the Remote Access listener instead of the desktop process.
 *
 * Every tile reaches Go through the generated bindings, which dereference
 * `window['go']['main']['App'][Method]` at call time, and reaches events
 * through `window.runtime.EventsOnMultiple`. A browser served by the listener
 * has neither, so `installRemoteRuntime()` supplies both before React mounts
 * and no tile changes. `demo/backend/` is the same trick over fixtures and the
 * precedent for the shape; nothing under `src/` may import it, so this is the
 * independent copy for a real backend.
 *
 * Loaded only by a dynamic import from `main.tsx`, so the desktop's entry chunk
 * does not pay for it (`pnpm check-bundle`).
 *
 * The wire contract is `backend/services/remote.go` (`POST /api/rpc`) and
 * `remote_ws.go` (`GET /ws`; the `remote:hello` first frame carries the latest
 * seq, whether the replay had a gap, and the run id). Nothing here persists:
 * the session is a cookie the server sets, and the event position is a
 * variable, because a token or a cursor in `localStorage` or a URL is banned by
 * § S8.5 and by `agent_docs/CLAUDE.md`.
 */

export interface RemoteRuntimeOptions {
  /** The session ended after the dashboard was up. Defaults to a reload, which lands on the gate. */
  onLocked?: () => void
  /** Events were lost that a replay cannot restore. Defaults to a reload, which re-primes every tile. */
  onResync?: () => void
}

export type SessionState = 'ok' | 'locked' | 'unreachable'

type Listener = (...args: unknown[]) => void
interface Subscription {
  cb: Listener
  remaining: number
}

const reload = () => window.location.reload()

const state = {
  onLocked: reload,
  onResync: reload,
  // Set once any call has been answered, which is what makes a later 401 mean
  // "the session ended" rather than "you have not signed in yet".
  confirmed: false,
  // One reload per lapse. `installGlobalErrorReporting` forwards a rejection
  // through `LogClientError`, so a 401 that reloaded unconditionally would
  // loop from the gate page: reload, fail, report, 401, reload.
  lockedFired: false,
  lastSeq: 0,
  // The server run the position belongs to, from the last hello. A number is
  // only comparable inside one run, so it travels with `since`.
  run: '',
}

const listeners = new Map<string, Set<Subscription>>()

const UNREACHABLE = 'Konnekt is unreachable. Check that the app is running and try again.'

function fireLocked(): void {
  if (state.lockedFired) return
  state.lockedFired = true
  state.onLocked()
}

function post(method: string, args: unknown[]): Promise<Response> {
  return fetch('/api/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ method, args }),
  })
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** `undefined` for text that is not JSON: both callers treat that as "not ours". */
function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** What a non-200 reply says: the JSON `error` the dispatcher writes, else the guard's plain text. */
async function failureMessage(res: Response): Promise<string> {
  const text = (await res.text()).trim()
  const parsed = parseJSON(text)
  if (isRecord(parsed) && typeof parsed.error === 'string' && parsed.error !== '') {
    return parsed.error
  }
  return text.slice(0, 200) || `Request failed (${res.status})`
}

/**
 * One bound call. Resolves with `result` (absent for a void method), rejects
 * with the message string for a method that ran and said no, which is what
 * Wails v2's own runtime rejects with, so `errMsg` and every caller's catch
 * read it the same either way.
 */
async function call(method: string, args: unknown[]): Promise<unknown> {
  let res: Response
  try {
    res = await post(method, args)
  } catch {
    throw new Error(UNREACHABLE)
  }
  if (res.status === 401) {
    if (state.confirmed) fireLocked()
    throw new Error('Signed out. Sign in again to continue.')
  }
  if (!res.ok) throw new Error(await failureMessage(res))
  state.confirmed = true
  const body = parseJSON(await res.text())
  if (!isRecord(body)) throw new Error('Konnekt sent an unreadable reply.')
  // The bare string, on purpose, see above.
  if (typeof body.error === 'string' && body.error !== '') return Promise.reject(body.error)
  return body.result
}

/**
 * Whether the session is usable, by the cheapest read-tier call there is. The
 * gate page and the socket's first failure both ask it, so "locked" and
 * "the app is not there" are told apart before anything is rendered.
 */
export async function probeSession(): Promise<SessionState> {
  let res: Response
  try {
    res = await post('GetAppVersion', [])
  } catch {
    return 'unreachable'
  }
  if (res.ok) {
    state.confirmed = true
    return 'ok'
  }
  return res.status === 401 ? 'locked' : 'unreachable'
}

// ── Events ──────────────────────────────────────────────────────────────
// Wails' bus in memory, with the demo's semantics (demo/backend/events.js):
// EventsOn and EventsOnce both funnel into EventsOnMultiple upstream, and the
// registration returns the unsubscriber that useMods and the others store.

function eventsOnMultiple(name: string, cb: Listener, max?: number): () => void {
  const sub: Subscription = { cb, remaining: max ?? -1 }
  let set = listeners.get(name)
  if (!set) {
    set = new Set()
    listeners.set(name, set)
  }
  set.add(sub)
  const owner = set
  return () => owner.delete(sub)
}

function dispatch(name: string, args: unknown[]): void {
  const set = listeners.get(name)
  if (!set) return
  // Copied before iterating: a one-shot removes itself, and a handler may
  // unsubscribe another.
  for (const sub of [...set]) {
    if (sub.remaining > 0 && --sub.remaining === 0) set.delete(sub)
    try {
      sub.cb(...args)
    } catch (e) {
      // One bad subscriber must not stop the rest, as on the real bus. The
      // name arrives in a server frame, so it is an argument, never part of
      // the format string, where a % in it would be read as a directive.
      console.error('remote: a listener threw for event', name, e)
    }
  }
}

function eventsOff(name: string, ...more: string[]): void {
  for (const n of [name, ...more]) listeners.delete(n)
}

interface Frame {
  seq: number
  event: string
  data: unknown
}

function parseFrame(raw: unknown): Frame | null {
  if (typeof raw !== 'string') return null
  const parsed = parseJSON(raw)
  if (!isRecord(parsed) || typeof parsed.seq !== 'number' || typeof parsed.event !== 'string') {
    return null
  }
  return { seq: parsed.seq, event: parsed.event, data: parsed.data }
}

const BACKOFF_START_MS = 1000
const BACKOFF_CAP_MS = 30_000

/**
 * Opens the event mirror and keeps it open. Returns the function that stops it.
 *
 * Every frame is numbered, and every hello names the server run that numbers
 * them. A reconnect asks for what it missed with `?since=<last seq>&run=<run>`,
 * and the server, not this page, decides whether that number belongs to its
 * current run, answering with a `remote:hello` that says whether the replay
 * could cover it. When it could not, the tiles hold a hole and `onResync`
 * re-primes them the way a fresh page does. `hello.seq < lastSeq` stays as a
 * defence for a server that predates the run id.
 */
export function connectEvents(): () => void {
  let socket: WebSocket | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let backoff = BACKOFF_START_MS
  let stopped = false

  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(open, backoff)
    backoff = Math.min(backoff * 2, BACKOFF_CAP_MS)
  }

  const onHello = (hello: Frame) => {
    backoff = BACKOFF_START_MS
    const replayed = isRecord(hello.data) ? hello.data.replayed : undefined
    // Taken from every hello, a gap one included: that is the new run.
    if (isRecord(hello.data) && typeof hello.data.run === 'string') state.run = hello.data.run
    if ((isRecord(hello.data) && hello.data.gap === true) || hello.seq < state.lastSeq) {
      // Take the server's position, so a handler that does not reload does not
      // see the same gap again on the next reconnect.
      state.lastSeq = hello.seq
      state.onResync()
    } else if (replayed === 0) {
      // Nothing was missed and nothing is coming: the server's number is ours.
      // With a replay pending it must not be, or the replay would read as seen.
      state.lastSeq = hello.seq
    }
  }

  function open() {
    if (stopped || socket) return
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const since =
      state.lastSeq > 0
        ? `?since=${state.lastSeq}${state.run ? `&run=${encodeURIComponent(state.run)}` : ''}`
        : ''
    const ws = new WebSocket(`${scheme}//${window.location.host}/ws${since}`)
    socket = ws
    let sawHello = false

    ws.onmessage = (ev: MessageEvent) => {
      const frame = parseFrame(ev.data)
      if (!frame) {
        console.warn('remote: ignored a malformed event frame')
        return
      }
      if (frame.event === 'remote:hello') {
        sawHello = true
        onHello(frame)
        return
      }
      if (frame.seq <= state.lastSeq) return
      state.lastSeq = frame.seq
      dispatch(frame.event, [frame.data])
    }

    ws.onclose = () => {
      if (socket !== ws) return
      socket = null
      if (stopped) return
      schedule()
      if (sawHello) return
      // Closed before it said anything: the upgrade was refused. A 401 on the
      // upgrade is indistinguishable from a network failure here, so ask.
      void probeSession().then((s) => {
        if (s !== 'locked') return
        stopped = true
        clearTimeout(timer)
        fireLocked()
      })
    }
  }

  // A phone that slept or lost signal should not wait out the backoff once the
  // page is back in front of the user.
  const wake = () => {
    if (stopped || socket) return
    clearTimeout(timer)
    open()
  }
  const onVisibility = () => {
    if (document.visibilityState === 'visible') wake()
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('online', wake)

  open()

  return () => {
    stopped = true
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('online', wake)
    const ws = socket
    socket = null
    ws?.close()
  }
}

// ── window.runtime ──────────────────────────────────────────────────────
// Every export of wailsjs/runtime/runtime.js derefs one of these inside its own
// body, and `remoteRuntime.test.ts` reads that file to hold the list complete.
// A native window has no meaning in a tab, so its controls are no-ops rather
// than refusals: the app's own title bar calls them and a failure per click
// would be noise.

const noop = () => undefined
const asyncNoop = () => Promise.resolve(undefined)

const log =
  (level: 'debug' | 'info' | 'warn' | 'error') =>
  (...args: unknown[]) =>
    console[level](...args)

/** Only web links leave the page: a `javascript:` URL has no business in a new tab. */
function openUrl(url: string): void {
  const target = new URL(url, window.location.href)
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return
  window.open(target.href, '_blank', 'noopener,noreferrer')
}

function buildRuntime() {
  return {
    EventsOnMultiple: eventsOnMultiple,
    EventsOn: (name: string, cb: Listener) => eventsOnMultiple(name, cb, -1),
    EventsOnce: (name: string, cb: Listener) => eventsOnMultiple(name, cb, 1),
    EventsOff: eventsOff,
    EventsOffAll: () => listeners.clear(),
    // Local only: the desktop's EventsEmit is not forwarded to Go either.
    EventsEmit: (name: string, ...args: unknown[]) => dispatch(name, args),

    BrowserOpenURL: openUrl,

    LogPrint: log('info'),
    LogTrace: log('debug'),
    LogDebug: log('debug'),
    LogInfo: log('info'),
    LogWarning: log('warn'),
    LogError: log('error'),
    LogFatal: log('error'),

    WindowReload: reload,
    WindowReloadApp: reload,
    WindowSetTitle: (title: string) => {
      document.title = title
    },
    WindowSetAlwaysOnTop: noop,
    WindowSetSystemDefaultTheme: noop,
    WindowSetLightTheme: noop,
    WindowSetDarkTheme: noop,
    WindowCenter: noop,
    WindowFullscreen: noop,
    WindowUnfullscreen: noop,
    WindowIsFullscreen: () => Promise.resolve(false),
    WindowGetSize: () => Promise.resolve({ w: window.innerWidth, h: window.innerHeight }),
    WindowSetSize: noop,
    WindowSetMaxSize: noop,
    WindowSetMinSize: noop,
    WindowSetPosition: noop,
    WindowGetPosition: () => Promise.resolve({ x: 0, y: 0 }),
    WindowHide: noop,
    WindowShow: noop,
    WindowMaximise: noop,
    WindowToggleMaximise: noop,
    WindowUnmaximise: noop,
    WindowIsMaximised: () => Promise.resolve(false),
    WindowMinimise: noop,
    WindowUnminimise: noop,
    WindowSetBackgroundColour: noop,
    WindowIsMinimised: () => Promise.resolve(false),
    WindowIsNormal: () => Promise.resolve(true),
    ScreenGetAll: () => Promise.resolve([]),
    Quit: noop,
    Hide: noop,
    Show: noop,

    Environment: () => Promise.resolve({ buildType: 'production', platform: 'web', arch: '' }),

    ClipboardGetText: () => navigator.clipboard?.readText?.() ?? Promise.resolve(''),
    ClipboardSetText: (text: string) =>
      navigator.clipboard?.writeText
        ? navigator.clipboard.writeText(text).then(() => true)
        : Promise.resolve(false),

    // Native drag-and-drop and OS notifications have no remote equivalent. The
    // app raises its own through `emitNotification`, and a path a browser
    // cannot resolve is not one Go could be handed.
    OnFileDrop: noop,
    OnFileDropOff: noop,
    CanResolveFilePaths: () => false,
    ResolveFilePaths: noop,
    InitializeNotifications: asyncNoop,
    CleanupNotifications: asyncNoop,
    IsNotificationAvailable: () => Promise.resolve(false),
    RequestNotificationAuthorization: () => Promise.resolve(false),
    CheckNotificationAuthorization: () => Promise.resolve(false),
    SendNotification: asyncNoop,
    SendNotificationWithActions: asyncNoop,
    RegisterNotificationCategory: asyncNoop,
    RemoveNotificationCategory: asyncNoop,
    RemoveAllPendingNotifications: asyncNoop,
    RemovePendingNotification: asyncNoop,
    RemoveAllDeliveredNotifications: asyncNoop,
    RemoveDeliveredNotification: asyncNoop,
    RemoveNotification: asyncNoop,
  }
}

/**
 * Installs `window.go.main.App` and `window.runtime`, once, before React mounts.
 *
 * The method list is the generated bindings' own export list, so a bound
 * method added tomorrow is installed without anyone remembering to add it; the
 * server's allowlist (`remote_methods.go`) decides which of them answer.
 */
export function installRemoteRuntime(options: RemoteRuntimeOptions = {}): void {
  state.onLocked = options.onLocked ?? reload
  state.onResync = options.onResync ?? reload
  state.confirmed = false
  state.lockedFired = false
  state.lastSeq = 0
  state.run = ''
  listeners.clear()

  const App = Object.fromEntries(
    Object.keys(Bindings).map((method) => [method, (...args: unknown[]) => call(method, args)]),
  )
  Object.assign(window, { go: { main: { App } }, runtime: buildRuntime() })
}
