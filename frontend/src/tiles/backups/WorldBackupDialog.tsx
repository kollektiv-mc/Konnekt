import { useState } from 'react'
import { Combobox } from '../../components/ui/Combobox'
import type { ServerWorld } from './useServerWorldNames'

interface Props {
  worlds: ServerWorld[]
  /** The world selected when the dialog opens. */
  initial: string
  onConfirm: (world: string) => void
  onCancel: () => void
}

/**
 * Which world to back up. The backdrop-and-card shape of `BackupRunningDialog`,
 * with the one choice a world backup needs.
 */
export function WorldBackupDialog({ worlds, initial, onConfirm, onCancel }: Props) {
  const [world, setWorld] = useState(initial)

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-black/55"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="bg-surface border-border-subtle border-hairline mx-4 flex w-full max-w-xs flex-col gap-3 rounded-lg px-4 py-4">
        <p className="text-text-secondary font-mono text-xs leading-relaxed">
          Back up one world, with its Nether and End folders. A running server flushes its saves
          first.
        </p>
        <Combobox
          ariaLabel="World to back up"
          value={world}
          onChange={setWorld}
          options={worlds.map((w) => ({
            value: w.name,
            label: w.active ? `${w.name} (active)` : w.name,
          }))}
          placeholder="Choose a world"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-text-faint hover:text-text-muted px-3 py-1 font-mono text-xs transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(world)}
            disabled={!world}
            className="border-accent text-accent hover:bg-accent/10 rounded border bg-transparent px-3 py-1 font-mono text-xs transition-colors disabled:opacity-40"
          >
            Back up
          </button>
        </div>
      </div>
    </div>
  )
}
