import type { models } from '../../../../wailsjs/go/models'
import { CATEGORY_COLOR, CATEGORY_ICON, CATEGORY_TEXT_CLASS, orderedCategories } from './blockMeta'
import { useSettingsStore } from '../../../stores/useSettingsStore'

interface Props {
  blockDefs: models.BlockDef[]
  onAdd: (def: models.BlockDef) => void
}

export function BlockPalette({ blockDefs, onAdd }: Props) {
  const { settings, update } = useSettingsStore()
  const collapsed = settings.schedulerPaletteCollapsed
  const closed = settings.schedulerPaletteClosedCategories

  const categories = orderedCategories(blockDefs)

  // Both swallow: `update` reverts the collapse state itself, so the panel
  // springs back on a refused write and the settings modal shows why.
  function toggleCollapsed() {
    update({ schedulerPaletteCollapsed: !collapsed }).catch(() => {})
  }

  function toggleCategory(cat: string) {
    update({ schedulerPaletteClosedCategories: { ...closed, [cat]: !closed[cat] } }).catch(() => {})
  }

  if (collapsed) {
    return (
      <div
        className="bg-canvas border-border-subtle border-r-hairline flex w-5 shrink-0 cursor-pointer items-center justify-center"
        onClick={toggleCollapsed}
        title="Expand blocks"
      >
        <span className="text-text-faint font-mono text-[11px] select-none">›</span>
      </div>
    )
  }

  return (
    <div className="bg-canvas border-border-subtle border-r-hairline w-48 shrink-0 overflow-y-auto">
      <div className="px-2 py-2">
        <div className="text-text-faint mb-2 flex items-center font-mono text-xs">
          <span className="flex-1">blocks</span>
          <span
            onClick={toggleCollapsed}
            title="Collapse palette"
            className="cursor-pointer pl-1 select-none"
          >
            ‹
          </span>
        </div>

        {categories.map((cat) => {
          const defs = blockDefs.filter((d) => d.category === cat)
          if (defs.length === 0) return null
          const color = CATEGORY_COLOR[cat] ?? '#6b7280'
          const textClass = CATEGORY_TEXT_CLASS[cat] ?? 'text-[#6b7280]'
          const icon = CATEGORY_ICON[cat] ?? '?'
          const isClosed = !!closed[cat]

          return (
            <div key={cat} className="mb-3">
              <div
                className={`mb-1 flex cursor-pointer items-center gap-1 font-mono text-xs uppercase select-none ${textClass}`}
                onClick={() => toggleCategory(cat)}
              >
                <span className="text-[9px]">{isClosed ? '▸' : '▾'}</span>
                <span>{icon}</span>
                <span>{cat}</span>
              </div>

              {!isClosed &&
                defs.map((def) => (
                  <div
                    key={def.id}
                    draggable
                    onClick={() => onAdd(def)}
                    onDragStart={(e) => e.dataTransfer.setData('blockType', def.id)}
                    title={def.description}
                    className="bg-surface border-border-subtle text-text-primary border-hairline mb-0.5 cursor-pointer rounded px-2 py-1 font-mono text-[11px] select-none"
                    onMouseEnter={(e) =>
                      ((e.currentTarget as HTMLDivElement).style.borderColor = color)
                    }
                    onMouseLeave={(e) =>
                      ((e.currentTarget as HTMLDivElement).style.borderColor =
                        'var(--border-subtle)')
                    }
                  >
                    {def.label}
                  </div>
                ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
