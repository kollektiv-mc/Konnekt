import { useState } from 'react'
import { usePresence, useRetained } from '../../../hooks/usePresence'
import type { EditRow } from './editMenuRows'
import { NodeMenu } from './NodeMenu'
import type { Point } from './quickAddPlacement'

/** Where the menu opens, and where on the canvas a paste lands. */
export interface NodeMenuRequest {
  screen: Point
  flow: Point
}

interface Props {
  /** Null while closed; a request opens it, and clearing it plays the exit. */
  request: NodeMenuRequest | null
  rows: EditRow[]
  onClose: () => void
}

/**
 * Keeps the node menu mounted while it fades out, the way `QuickAddHost` does
 * for the quick-add list: the editor sets a request to open it and clears it to
 * close it (a pick, Escape, a press outside), and this gives each of those an
 * exit. Each opening is a new menu, so a request that arrives mid-fade replaces
 * the last rather than inheriting its open fly-out, and a leaving menu answers
 * to nothing.
 */
export function NodeMenuHost({ request, rows, onClose }: Props) {
  const shown = useRetained(request)
  const presence = usePresence(request !== null, 'menu')
  const [seen, setSeen] = useState(request)
  const [opening, setOpening] = useState(0)
  if (request !== seen) {
    setSeen(request)
    if (request) setOpening((n) => n + 1)
  }

  if (!presence.mounted || !shown) return null
  return (
    <NodeMenu
      key={opening}
      rows={rows}
      screenPos={shown.screen}
      leaving={presence.leaving}
      onClose={() => {
        if (!presence.leaving) onClose()
      }}
    />
  )
}
