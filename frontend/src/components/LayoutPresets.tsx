import { useEffect, useState } from 'react'
import { useLayoutStore } from '../stores/useLayoutStore'
import { SaveLayoutPreset } from '../../wailsjs/go/main/App'
import { DEFAULT_LAYOUT_PRESETS } from '../lib/constants'
import { Collapsible } from './ui/Collapsible'
import { IconButton } from './ui/IconButton'
import { ChevronDown, ChevronUp, X } from '../lib/icons'
import { Icon } from './ui/Icon'

// How long an armed reset stays armed.
const RESET_CONFIRM_MS = 4000

export function LayoutPresets() {
  const { presets, activePresetName, error, savePreset, loadPreset, loadPresets, deletePreset } =
    useLayoutStore()
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [collapsed, setCollapsed] = useState(true)
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
    // flex-col-reverse, so the list grows *upwards*. This is the last section
    // in the navbar, so expanding it downwards is not an option — the panel
    // would push its own header up the screen every time it opened. Reversing
    // pins the header to the bottom edge and lets the presets stack above it,
    // while the DOM keeps the disclosure button ahead of the content it
    // controls.
    <div className="flex flex-col-reverse overflow-hidden">
      {/* The section rule belongs to the header, not to the section, because
          the header is the part that stays put. Carried on App's wrapper it
          sat at the top of a box that grows upwards, so opening the panel
          walked the line two hundred pixels up the navbar and left it
          introducing the crate rather than the presets underneath it. */}
      <div className="border-t-hairline border-border-subtle shrink-0 px-3 py-2">
        <button
          onClick={() => {
            setCollapsed((c) => !c)
            setConfirmingReset(false)
          }}
          className="font-title text-text-muted hover:text-text-secondary flex w-full cursor-pointer items-center justify-between text-xs font-medium tracking-wider uppercase transition-colors"
        >
          <span>Layouts</span>
          {/* The same 24px box the gear and expand controls use, so the
              navbar's right-hand column does not break at the last row. The
              glyph swaps rather than rotating, the way every other collapsible
              in the app does. It points up because this is the one panel that
              opens upwards. (The original reason to swap rather than rotate was
              that a triangle glyph's ink is not centred in its box; a lucide
              chevron's is, so rotating would work now too. Swapping is kept
              because it still reads clearer and matches the other panels.) */}
          <span className="flex h-6 w-6 items-center justify-center">
            <Icon icon={collapsed ? ChevronUp : ChevronDown} />
          </span>
        </button>
      </div>

      <Collapsible open={!collapsed} className="min-w-0">
        {/* The panel opens upwards, so this edge is what meets the section
            above it. The same rule the header carries, closing the container
            at the other end; the padding inside it keeps the first preset off
            the line. */}
        <div className="border-t-hairline border-border-subtle flex min-h-0 min-w-0 flex-col gap-2 px-3 pt-3 pb-2">
          {presets.map((preset) => (
            <div key={preset.name} className="flex items-center gap-1">
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
                className={`flex-1 cursor-pointer truncate rounded px-2 py-1.5 text-left text-xs transition-all ${
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

          <div className="mt-1 flex gap-1">
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
            <div role="alert" className="text-danger font-mono text-xs">
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
            className={`mt-1 cursor-pointer truncate text-left text-xs whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              confirmingReset ? 'text-danger' : 'text-text-faint enabled:hover:text-text-muted'
            }`}
          >
            {resetting ? 'Resetting…' : confirmingReset ? '↺ Confirm reset' : '↺ Reset to defaults'}
          </button>
        </div>
      </Collapsible>
    </div>
  )
}
