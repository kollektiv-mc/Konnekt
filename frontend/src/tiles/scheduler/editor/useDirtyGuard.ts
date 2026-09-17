import { useCallback, useRef, useState } from 'react'

export interface DirtyGuard {
  /** True while the unsaved-changes dialog should be on screen. */
  pending: boolean
  /**
   * Run `action` now if the editor is clean, or hold it behind the dialog if it
   * is not. Every path that replaces what the editor holds goes through this.
   */
  guard: (action: () => void) => void
  /** Hold `action` behind the dialog whatever the dirty state says. */
  hold: (action: () => void) => void
  /** Drop the held action and hide the dialog. The editor keeps what it has. */
  cancel: () => void
  /** Hide the dialog and run the held action. */
  proceed: () => void
}

/**
 * One unsaved-changes dialog serving every graph-replacing action (#124).
 *
 * The scheduler editor used to guard exactly one exit, closing the maximized
 * tile, with the continuation written into the dialog's own button. Switching
 * graphs from the dropdown and pressing `new` replaced the graph with no prompt
 * at all, so unsaved edits went silently. Carrying the continuation here
 * instead of in the dialog is what lets the three share one prompt.
 *
 * `isDirty` is a getter rather than a boolean, and it is read through a ref, so
 * every callback returned here keeps one identity for the life of the editor.
 * Both halves are needed. A boolean would change on every node drag; a getter
 * in the dependency array would too, because callers write it inline. And
 * `guard` is what the close guard closes over, so an identity that moved would
 * re-register that guard on each of those drags.
 */
export function useDirtyGuard(isDirty: () => boolean): DirtyGuard {
  const [pending, setPending] = useState(false)
  const action = useRef<(() => void) | null>(null)
  const dirty = useRef(isDirty)
  dirty.current = isDirty

  const hold = useCallback((next: () => void) => {
    action.current = next
    setPending(true)
  }, [])

  const guard = useCallback(
    (next: () => void) => {
      if (!dirty.current()) {
        next()
        return
      }
      hold(next)
    },
    [hold],
  )

  const cancel = useCallback(() => {
    action.current = null
    setPending(false)
  }, [])

  const proceed = useCallback(() => {
    const next = action.current
    // Cleared before running, so an action that throws cannot leave itself
    // armed for whatever opens the dialog next.
    action.current = null
    setPending(false)
    next?.()
  }, [])

  return { pending, guard, hold, cancel, proceed }
}
