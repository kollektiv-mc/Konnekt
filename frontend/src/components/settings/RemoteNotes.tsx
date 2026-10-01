import type { ReactNode } from 'react'
import { isRemoteBrowser } from '../../lib/ipc'

function RemoteNote({ children }: { children: ReactNode }) {
  return <p className="text-text-muted text-1xs py-2">{children}</p>
}

// The panes whose settings the page keeps in memory only, so a reload drops them.
const BROWSER_ONLY = ['appearance', 'console', 'notifications']

/** Above Appearance, Console and Notifications, in a browser served by the listener. */
export function ReloadNote({ section }: { section: string }) {
  if (!isRemoteBrowser() || !BROWSER_ONLY.includes(section)) return null
  return <RemoteNote>Changes here apply to this browser until it reloads.</RemoteNote>
}

/** Stands where About's install controls would be: they replace the host's executable. */
export function UpdateFromDesktop() {
  return <RemoteNote>Update Konnekt from the desktop.</RemoteNote>
}

/** About's data directory as text: opening it is a folder on the desktop. */
export function PlainDataDir({ path }: { path: string | null }) {
  return <span className="text-text-muted text-1xs max-w-56 truncate font-mono">{path ?? '—'}</span>
}
