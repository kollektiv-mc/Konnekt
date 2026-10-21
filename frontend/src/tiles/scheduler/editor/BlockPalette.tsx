import type { models } from '../../../../wailsjs/go/models'
import {
  CATEGORY_ICON,
  categoryColor,
  categoryTextClass,
  NO_GRAPH_KEYS,
  orderedCategories,
} from './blockMeta'
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
      <button
        type="button"
        onClick={toggleCollapsed}
        title="Expand blocks"
        aria-label="Expand blocks"
        className={`bg-canvas border-border-subtle border-r-hairline hover:bg-hover text-text-faint text-1xs flex w-5 shrink-0 cursor-pointer items-center justify-center font-mono transition-colors select-none ${NO_GRAPH_KEYS}`}
      >
        ›
      </button>
    )
  }

  // The scroll area and the edge strip are siblings, so the strip stays the
  // palette's full height while the list scrolls beside it.
  return (
    <div
      className={`bg-canvas border-border-subtle border-r-hairline flex w-48 shrink-0 ${NO_GRAPH_KEYS}`}
    >
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="px-2 py-2">
          <div className="text-text-faint mb-2 font-mono text-xs">blocks</div>

          {categories.map((cat) => {
            const defs = blockDefs.filter((d) => d.category === cat)
            if (defs.length === 0) return null
            const color = categoryColor(cat)
            const textClass = categoryTextClass(cat)
            const icon = CATEGORY_ICON[cat] ?? '?'
            const isClosed = !!closed[cat]

            return (
              <div key={cat} className="mb-3">
                <div
                  className={`mb-1 flex cursor-pointer items-center gap-1 font-mono text-xs uppercase select-none ${textClass}`}
                  onClick={() => toggleCategory(cat)}
                >
                  <span className="text-3xs">{isClosed ? '▸' : '▾'}</span>
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
                      className="bg-surface border-border-subtle text-text-primary border-hairline text-1xs mb-0.5 cursor-pointer rounded px-2 py-1 font-mono select-none"
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
      <button
        type="button"
        onClick={toggleCollapsed}
        title="Collapse blocks"
        aria-label="Collapse blocks"
        className="hover:bg-hover text-text-faint text-1xs flex w-5 shrink-0 cursor-pointer items-center justify-center font-mono transition-colors select-none"
      >
        ‹
      </button>
    </div>
  )
}
