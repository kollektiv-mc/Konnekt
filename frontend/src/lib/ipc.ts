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
