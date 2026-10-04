import { useState } from 'react'
import { useRemoteClient } from '../hooks/useRemoteClient'
import { signOut } from '../lib/remoteRuntime'

/**
 * The parts of the window that exist only in a browser served by Remote Access.
 * Both import `lib/remoteRuntime`, so this module is loaded with `React.lazy`
 * and only when `isRemoteBrowser()`: a static import from anything the desktop
 * also loads would put the runtime in its entry chunk (`pnpm check-bundle`).
 */

/** Shown while an admin-tier call waits for someone at the desktop to answer it. */
export function RemoteBanner() {
  const { waiting } = useRemoteClient()
  if (waiting.length === 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-canvas text-warning border-warning/30 text-2xs z-popover border-hairline fixed top-1.5 left-1/2 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-2 rounded px-3 py-1"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      <span className="shrink-0">Waiting for approval on the desktop</span>
      <span className="truncate font-mono">{[...new Set(waiting)].join(', ')}</span>
    </div>
  )
}

/** The title bar's half: who this browser is, and the way out. */
export function RemoteSession() {
  const { device } = useRemoteClient()
  const [leaving, setLeaving] = useState(false)

  return (
    <>
      {device !== '' && (
        <span
          title={`Signed in as ${device}`}
          className="text-2xs text-muted mr-1 max-w-40 truncate max-sm:hidden"
        >
          {device}
        </span>
      )}
      <button
        type="button"
        disabled={leaving}
        onClick={() => {
          setLeaving(true)
          void signOut()
        }}
        className="titlebar-no-drag border-hairline border-border-subtle text-2xs text-muted hover:bg-hover mr-1 flex h-6 items-center rounded px-2 transition-colors disabled:opacity-50"
      >
        Sign out
      </button>
    </>
  )
}
