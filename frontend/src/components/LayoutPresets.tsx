import { useState } from 'react'
import { useLayoutStore } from '../stores/useLayoutStore'
import { SaveLayoutPreset } from '../../wailsjs/go/main/App'
import { DEFAULT_LAYOUT_PRESETS } from '../lib/constants'
import { Collapsible } from './ui/Collapsible'

export function LayoutPresets() {
  const { presets, activePresetName, savePreset, loadPreset, loadPresets, deletePreset } =
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
    await savePreset(name)
    setNewName('')
    setSaving(false)
  }

  return (
    <div className="flex flex-col gap-2 overflow-hidden p-2">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="font-title text-text-muted flex w-full items-center justify-between px-1 text-xs font-medium tracking-wider uppercase transition-colors"
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'
        }}
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
              <button
                onClick={() => loadPreset(preset.name)}
                className={`flex-1 rounded px-3 py-1.5 text-left text-xs transition-all ${
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
                <button
                  onClick={() => deletePreset(preset.name)}
                  className="text-text-faint px-1.5 text-xs transition-colors"
                  onMouseEnter={(e) => {
                    ;(e.currentTarget as HTMLButtonElement).style.color = '#f87171'
                  }}
                  onMouseLeave={(e) => {
                    ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-faint)'
                  }}
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

          <button
            onClick={handleReset}
            disabled={resetting}
            className="text-text-faint mt-1 px-1 text-left text-xs transition-colors disabled:opacity-40"
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
