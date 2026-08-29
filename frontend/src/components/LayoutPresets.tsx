import { useState } from 'react'
import { useLayoutStore } from '../stores/useLayoutStore'
import { SaveLayoutPreset } from '../../wailsjs/go/main/App'
import { DEFAULT_LAYOUT_PRESETS } from '../lib/constants'
import { Collapsible } from './ui/Collapsible'

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
    <div className="flex flex-col gap-2 overflow-hidden p-2">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="font-title text-text-muted hover:text-text-secondary flex w-full cursor-pointer items-center justify-between px-1 text-xs font-medium tracking-wider uppercase transition-colors"
      >
        <span>Layouts</span>
        <span
          className={`duration-fast ease-standard inline-block transition-transform ${collapsed ? '-rotate-90' : 'rotate-0'}`}
        >
          ▾
        </span>
      </button>

      <Collapsible open={!collapsed} className="min-w-0">
        <div className="flex min-h-0 min-w-0 flex-col gap-2">
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
                className={`flex-1 cursor-pointer rounded px-3 py-1.5 text-left text-xs transition-all ${
                  preset.name === activePresetName
                    ? 'text-accent bg-accent/10'
                    : 'text-text-secondary hover:bg-hover hover:text-text-primary bg-transparent'
                }`}
              >
                {preset.name}
              </button>
              {preset.name !== 'Default' && (
                <button
                  onClick={() => handleDelete(preset.name)}
                  className="text-text-faint hover:text-danger cursor-pointer px-1.5 text-xs transition-colors"
                  title="Delete preset"
                >
                  ×
                </button>
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
            <div role="alert" className="text-danger px-1 font-mono text-xs">
              {error}
            </div>
          )}

          <button
            onClick={handleReset}
            disabled={resetting}
            className="text-text-faint enabled:hover:text-text-muted mt-1 cursor-pointer px-1 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            {resetting ? 'Resetting…' : '↺ Reset to defaults'}
          </button>
        </div>
      </Collapsible>
    </div>
  )
}
