import { useEffect, useState } from 'react'
import { GetReleaseNotes } from '../../wailsjs/go/main/App'
import type { models } from '../../wailsjs/go/models'

export type ReleaseNotesState =
  | { status: 'loading' }
  | { status: 'ready'; notes: models.ReleaseNotes }
  | { status: 'unavailable' }

/**
 * Settings > What's New's data, asked for each time the pane mounts. Go
 * answers from its cache when that is recent, so reopening the pane does not
 * spend GitHub's rate limit. A rejection means GitHub was unreachable and
 * nothing was cached yet, or there is no Wails bridge; the pane says so and
 * still links to the releases page.
 */
export function useReleaseNotes(): ReleaseNotesState {
  const [state, setState] = useState<ReleaseNotesState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const notes = await GetReleaseNotes()
        if (!cancelled) setState({ status: 'ready', notes })
      } catch {
        if (!cancelled) setState({ status: 'unavailable' })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
