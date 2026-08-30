import { useEffect, useState } from 'react'
import { useLayoutStore } from '../stores/useLayoutStore'
import { SaveLayoutPreset } from '../../wailsjs/go/main/App'
import { DEFAULT_LAYOUT_PRESETS } from '../lib/constants'
import { IconButton } from './ui/IconButton'
import { NavSection } from './ui/NavSection'
import { X } from '../lib/icons'
import { Icon } from './ui/Icon'

// How long an armed reset stays armed.
const RESET_CONFIRM_MS = 4000

export function LayoutPresets() {
  const { presets, activePresetName, error, savePreset, loadPreset, loadPresets, deletePreset } =
    useLayoutStore()
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)

  // An armed reset disarms itself. A destructive control left primed is a trap
  // for the next click that lands near it, and the user has already moved on
  // by the time this fires.
  useEffect(() => {
    if (!confirmingReset) return
    const t = setTimeout(() => setConfirmingReset(false), RESET_CONFIRM_MS)
    return () => clearTimeout(t)
  }, [confirmingReset])

  const handleReset = async () => {
    setResetting(true)
    try {
      for (const p of DEFAULT_LAYOUT_PRESETS) {
        await SaveLayoutPreset(p.name, p.layout).catch(() => {})
      }
      await loadPresets()
      loadPreset('Default')
    } finally {
      setResetting(false)
    }
  }

  // First click arms, second performs. Reset rewrites every default preset and
  // switches the canvas out from under you, which is not something to do on a
  // stray click at the very bottom of the navbar.
  const handleResetClick = () => {
    if (!confirmingReset) {
      setConfirmingReset(true)
      return
    }
    setConfirmingReset(false)
    void handleReset()
  }

  const handleSave = async () => {
    const name = newName.trim() || activePresetName
    if (!name) return
    setSaving(true)
    try {
      await savePreset(name)
      // Only clear the field on success, so a retry doesn't have to be retyped.
      setNewName('')
    } catch {
      /* The store's `error` renders below. */
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (name: string) => {
    // Nothing local to revert: the store kept the preset in the list.
    deletePreset(name).catch(() => {})
  }

  return (
    // Header on top, opening downward, the same way the three sections above it
    // do. It used to be flex-col-reverse with its header pinned to the navbar's
    // bottom edge and the list growing upwards, because as the last thing in the
    // column a downward panel would have pushed its own header up the screen.
    // That was a caption's problem: the sections are cards now and all four
    // scroll together, so the constraint that shaped this one is gone, and with
    // it the reversed column and the chevron that had to point the other way.
    <NavSection
      id="layouts"
      title="Layouts"
      // A reset armed and then closed away would still be armed when the
      // section is reopened, which is the trap the timeout below exists to
      // avoid. Closing disarms it, exactly as the old inline toggle did.
      onToggle={() => setConfirmingReset(false)}
    >
      <div className="flex min-w-0 flex-col gap-2 p-1 pt-2">
        {presets.map((preset) => (
          // pr-2 here and pl-3 on the button, for the reason ServerRow's row
          // carries the same pair: only the right half of the row's padding is
          // load-bearing, setting the delete control's column, while the left
          // half pushed this rectangle 8px inside the crate rows'. The button
          // takes those 8px back so the name does not move with it.
          <div key={preset.name} className="flex items-center gap-1 pr-2">
            {/* Same treatment as the server list above it in this sidebar
                  (components/ServerRow.tsx), and for the same reason: it is the
                  same control. It used to hand-roll hover through
                  onMouseEnter/onMouseLeave writing element.style.background,
                  guarded on `!== activePresetName`. Both halves of that guard
                  were bugs. Selecting a preset while hovering it left the
                  inline grey in place, and an inline style outranks the class,
                  so the active row rendered grey instead of accent. The
                  matching mouse-leave then saw the row as active, skipped the
                  reset, and stranded that grey there for good — one more row
                  each time the selection moved. */}
            <button
              onClick={() => loadPreset(preset.name)}
              // Truncates rather than wraps: a wrapped name makes its row
              // taller than the others and re-flows the list.
              className={`flex-1 cursor-pointer truncate rounded py-1.5 pr-1 pl-3 text-left text-xs transition-all ${
                preset.name === activePresetName
                  ? 'text-accent bg-accent/10'
                  : 'text-text-secondary hover:bg-hover hover:text-text-primary bg-transparent'
              }`}
            >
              {preset.name}
            </button>
            {preset.name !== 'Default' && (
              <IconButton
                onClick={() => handleDelete(preset.name)}
                title="Delete preset"
                tone="danger"
              >
                <Icon icon={X} />
              </IconButton>
            )}
          </div>
        ))}

        <div className="mt-1 flex gap-1 pr-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            placeholder={activePresetName || 'Preset name...'}
            className="bg-hover border-border-subtle text-text-primary hover:border-border-hover focus:border-border-hover border-hairline min-w-0 flex-1 rounded px-2 py-1 text-xs transition-colors outline-none"
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="border-border-subtle text-text-secondary enabled:hover:border-border-hover enabled:hover:text-text-primary border-hairline shrink-0 cursor-pointer rounded px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save
          </button>
        </div>

        {error && (
          <div role="alert" className="text-danger px-3 font-mono text-xs">
            {error}
          </div>
        )}

        {/* Never wraps. This row sits at the bottom of a panel the user can
              drag narrow, and a second line here would move the header the
              whole panel is anchored to. Hover comes from Tailwind rather than
              a mouse handler writing an inline colour, because the armed state
              changes the colour too and an inline one would outrank it. */}
        <button
          onClick={handleResetClick}
          disabled={resetting}
          className={`mt-1 cursor-pointer truncate px-3 text-left text-xs whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            confirmingReset ? 'text-danger' : 'text-text-faint enabled:hover:text-text-muted'
          }`}
        >
          {resetting ? 'Resetting…' : confirmingReset ? '↺ Confirm reset' : '↺ Reset to defaults'}
        </button>
      </div>
    </NavSection>
  )
}
