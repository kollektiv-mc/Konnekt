import { useState } from 'react'
import type { RefObject } from 'react'
import type { models } from '../../../../wailsjs/go/models'
import { usePresence, useRetained } from '../../../hooks/usePresence'
import { QuickAddMenu } from './QuickAddMenu'

/** Where the list opens, and where on the canvas a pick lands. */
export interface QuickAddRequest {
  screen: { x: number; y: number }
  flow: { x: number; y: number }
}

interface Props {
  /** Null while closed; a request opens it, and clearing it plays the exit. */
  request: QuickAddRequest | null
  blockDefs: models.BlockDef[]
  onPick: (def: models.BlockDef, flow: { x: number; y: number }) => void
  onClose: () => void
  /** The add button, which toggles the list (see QuickAddMenu). */
  trigger?: RefObject<HTMLElement | null>
}

/**
 * Keeps the quick-add list mounted while it fades out. Its three ways in (the
 * add button, a right-click, Tab) all set the editor's request and its ways out
 * (a pick, Escape, a press outside) all clear it, so one wrapper at the one
 * call site gives every one of them an exit without the menu knowing about it.
 *
 * Each opening is a new menu: a request that arrives while the last is still
 * fading replaces it rather than inheriting its query and open category. What
 * the exit draws is the request the menu had, kept by `useRetained`, and a
 * leaving menu answers to nothing, so a second pick or close mid-fade is
 * ignored.
 */
export function QuickAddHost({ request, blockDefs, onPick, onClose, trigger }: Props) {
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
    <QuickAddMenu
      key={opening}
      blockDefs={blockDefs}
      screenPos={shown.screen}
      leaving={presence.leaving}
      trigger={trigger}
      onPick={(def) => {
        if (!presence.leaving) onPick(def, shown.flow)
      }}
      onClose={() => {
        if (!presence.leaving) onClose()
      }}
    />
  )
}
