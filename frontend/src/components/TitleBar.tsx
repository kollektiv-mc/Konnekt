import { useCallback, useEffect, useState } from 'react'
import {
  Quit,
  WindowIsMaximised,
  WindowMinimise,
  WindowToggleMaximise,
} from '../../wailsjs/runtime/runtime'
import { IconButton } from './ui/IconButton'
import { Icon } from './ui/Icon'
import { Copy, Minus, Settings, Square, X } from '../lib/icons'
import { readOr } from '../lib/ipc'

interface Props {
  onOpenSettings: () => void
}

/**
 * The app's own title bar, in place of the system one (`Frameless: true` in
 * main.go, which explains what the window manager still does for us).
 *
 * It exists to hold three things that had nowhere better to be. The wordmark
 * and the settings gear used to sit in a 52px block at the top of the navbar,
 * which pushed the navbar's first card a header's height below the dashboard's
 * first tile — two columns of cards that never started on the same line. Moving
 * both up here empties that block, and the two columns now begin at the same
 * 12px inset. The window controls are the price of the system bar going away,
 * and they may as well share the bar.
 *
 * Everything in here is drawn by the app, so `applySkin()` themes it like any
 * other surface, which the system bar never did.
 */
export function TitleBar({ onOpenSettings }: Props) {
  const [maximized, setMaximized] = useState(false)

  // No Wails event reports a change of window state, so the DOM's own resize
  // event stands in: maximising, restoring, snapping to an edge and unsnapping
  // all resize the webview, and nothing that leaves its size alone changes the
  // answer. Trailing-debounced because dragging a window edge fires this
  // continuously and each sync is an IPC round trip.
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const sync = () => {
      // readOr, not a bare call: with no Wails runtime attached (the
      // browser-only `frontend-dev` preset, and jsdom) the binding throws
      // synchronously rather than rejecting. There is no window to be maximised
      // in either, so `false` is the honest answer and not a swallowed failure.
      readOr(() => WindowIsMaximised(), false).then((v) => {
        if (live) setMaximized(v)
      })
    }
    const onResize = () => {
      clearTimeout(timer)
      timer = setTimeout(sync, 120)
    }
    sync()
    window.addEventListener('resize', onResize)
    return () => {
      live = false
      clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const toggleMaximize = useCallback(() => {
    // Flip the glyph now rather than waiting on the debounced round trip above:
    // it is this control's own state, and 120ms of the old icon reads as a
    // dropped click. The listener corrects it if the window disagreed.
    setMaximized((v) => !v)
    windowCommand(WindowToggleMaximise)
  }, [])

  const minimize = useCallback(() => windowCommand(WindowMinimise), [])
  // Quit, not a window close: Wails routes it through OnBeforeClose, so this
  // button stops the scheduler and the running server exactly as the system
  // bar's × did (see app.go's beforeClose).
  const close = useCallback(() => windowCommand(Quit), [])

  return (
    // h-9 rather than the 52px the navbar header used: nothing has to line up
    // with this bar any more, and a system title bar is ~32px, so the chrome
    // should not cost more than it used to.
    //
    // It is also about as short as it can be. The runtime arms a 6px resize
    // border along the top of the webview and checks it before it checks
    // anything else, so any part of a control inside that band presses the
    // window edge rather than the control. A 24px button centred in this bar
    // measures a top of 5.5px, which hands the resize edge a half-pixel of it —
    // small enough not to be reachable in practice, and the reason to add
    // height here rather than remove it if this bar is ever restyled.
    <header className="titlebar-drag border-b-hairline border-border-subtle flex h-9 shrink-0 items-center">
      {/* The drag half. flex-1 so the empty space between the wordmark and the
          controls drags too, and so double-click-to-maximise (which no runtime
          gives us for free) covers it without also firing when a double-click
          lands on a button — the buttons are outside this element, not inside
          it, which is cheaper than stopping propagation on each one.

          pl-3 puts the wordmark on the dashboard grid's own 12px inset. It was
          pl-3 in the navbar too, for the different reason that a brand mark
          indented to the section chevrons would read as an indent. */}
      <div onDoubleClick={toggleMaximize} className="flex h-full min-w-0 flex-1 items-center pl-3">
        <span className="text-accent font-display text-sm font-black tracking-tight">Konnekt</span>
      </div>
      <div className="flex h-full items-center gap-0.5 pr-2">
        <IconButton className="titlebar-no-drag" onClick={onOpenSettings} title="Settings">
          <Icon icon={Settings} />
        </IconButton>
        {/* One hairline between the app's control and the window's. The close
            button is the only irreversible thing in this bar, and grouping by
            gap alone left it four pixels from a gear that opens a dialog. */}
        <div className="border-l-hairline border-border-subtle mx-1 h-4" />
        <IconButton className="titlebar-no-drag" onClick={minimize} title="Minimize window">
          <Icon icon={Minus} size="sm" />
        </IconButton>
        <IconButton
          className="titlebar-no-drag"
          onClick={toggleMaximize}
          title={maximized ? 'Restore window' : 'Maximize window'}
        >
          <Icon icon={maximized ? Copy : Square} size="sm" />
        </IconButton>
        <IconButton className="titlebar-no-drag" tone="danger" onClick={close} title="Close window">
          <Icon icon={X} size="sm" />
        </IconButton>
      </div>
    </header>
  )
}

/**
 * Run one of the window commands, tolerating there being no window.
 *
 * The generated runtime bindings dereference `window.runtime` the way the Go
 * bindings dereference `window.go`, so with no Wails process behind the page
 * every one of these throws a TypeError synchronously — the `frontend-dev`
 * preset in `.claude/launch.json` and the jsdom tests both. This is the
 * sanctioned no-bridge case from `agent_docs/CLAUDE.md`, and the simplest one
 * of them: these commands hold no state to revert, write nothing, and in a
 * browser tab there is no window to minimise, so there is nothing to report
 * either.
 */
function windowCommand(run: () => void) {
  try {
    run()
  } catch {
    /* no Wails runtime — see above */
  }
}
