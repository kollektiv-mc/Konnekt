import { useState } from 'react'
import { useLayoutStore } from '../stores/useLayoutStore'
import { SaveLayoutPreset } from '../../wailsjs/go/main/App'
import { DEFAULT_LAYOUT_PRESETS } from '../lib/constants'
import { Collapsible } from './ui/Collapsible'
import { IconButton } from './ui/IconButton'
import { CloseIcon } from './ui/icons'

export function LayoutPresets() {
  const { presets, activePresetName, error, savePreset, loadPreset, loadPresets, deletePreset } =
    useLayoutStore()
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [collapsed, setCollapsed] = useState(true)

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
          onClick={() => setCollapsed((c) => !c)}
          className="font-title text-text-muted flex w-full items-center justify-between text-xs font-medium tracking-wider uppercase transition-colors"
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'
          }}
        >
          <span>Layouts</span>
          {/* The same 24px box the gear and expand controls use, so the
              navbar's right-hand column does not break at the last row. The
              glyph swaps rather than rotating, the way every other collapsible
              in the app does: a rotation turns it about its box centre, and a
              triangle's ink is not centred in its box. It points up because
              this is the one panel that opens upwards. */}
          <span className="flex h-6 w-6 items-center justify-center">{collapsed ? '▴' : '▾'}</span>
        </button>
      </div>

      <Collapsible open={!collapsed} className="min-w-0">
        <div className="flex min-h-0 min-w-0 flex-col gap-2 px-3 pb-2">
          {presets.map((preset) => (
            <div key={preset.name} className="flex items-center gap-1">
              <button
                onClick={() => loadPreset(preset.name)}
                // Truncates rather than wraps: a wrapped name makes its row
                // taller than the others and re-flows the list.
                className={`flex-1 truncate rounded px-2 py-1.5 text-left text-xs transition-all ${
                  preset.name === activePresetName
                    ? 'text-accent bg-accent/10'
                    : 'text-text-secondary bg-transparent'
                }`}
                onMouseEnter={(e) => {
                  if (preset.name !== activePresetName) {
                    ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'
                    ;(e.currentTarget as HTMLButtonElement).style.background =
                      'var(--hover-surface)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (preset.name !== activePresetName) {
                    ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
                    ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                  }
                }}
              >
                {preset.name}
              </button>
              {preset.name !== 'Default' && (
                <IconButton
                  onClick={() => handleDelete(preset.name)}
                  title="Delete preset"
                  tone="danger"
                >
                  <CloseIcon />
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
              className="bg-hover border-border-subtle text-text-primary border-hairline min-w-0 flex-1 rounded px-2 py-1 text-xs outline-none"
              onFocus={(e) => {
                ;(e.target as HTMLInputElement).style.borderColor = 'var(--border-hover)'
              }}
              onBlur={(e) => {
                ;(e.target as HTMLInputElement).style.borderColor = 'var(--border-subtle)'
              }}
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="border-border-subtle text-text-secondary border-hairline shrink-0 rounded px-2 py-1 text-xs transition-colors disabled:opacity-40"
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-hover)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-subtle)'
              }}
            >
              Save
            </button>
          </div>

          {error && (
            <div role="alert" className="text-danger font-mono text-xs">
              {error}
            </div>
          )}

          <button
            onClick={handleReset}
            disabled={resetting}
            className="text-text-faint mt-1 text-left text-xs transition-colors disabled:opacity-40"
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-faint)'
            }}
          >
            {resetting ? 'Resetting…' : '↺ Reset to defaults'}
          </button>
        </div>
      </Collapsible>
    </div>
  )
}
