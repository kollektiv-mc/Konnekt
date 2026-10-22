import type { models } from '../../../../wailsjs/go/models'
import {
  CATEGORY_ICON,
  categoryColor,
  categoryTextClass,
  NO_GRAPH_KEYS,
  orderedCategories,
} from './blockMeta'
import { useSettingsStore } from '../../../stores/useSettingsStore'
import { Icon } from '../../../components/ui/Icon'
import { Package, PackageOpen } from '../../../lib/icons'

interface Props {
  blockDefs: models.BlockDef[]
  onAdd: (def: models.BlockDef) => void
}

export function BlockPalette({ blockDefs, onAdd }: Props) {
  const { settings, update } = useSettingsStore()
  const collapsed = settings.schedulerPaletteCollapsed
  const closed = settings.schedulerPaletteClosedCategories

  const categories = orderedCategories(blockDefs)

  // Swallowed: `update` reverts the setting itself on a refused write, and
  // the settings modal shows why.
  function toggleCategory(cat: string) {
    update({ schedulerPaletteClosedCategories: { ...closed, [cat]: !closed[cat] } }).catch(() => {})
  }

  // One shell for both states, so closing and opening animate its width
  // rather than swapping one element for another. The list keeps a fixed width
  // inside it, so the text is clipped by the narrowing shell instead of
  // reflowing, and it fades as it goes. Closed, it is no width at all and stays
  // mounted but inert, out of the tab order and the accessibility tree. It is
  // opened and closed from PaletteToggle, on the canvas beside it.
  return (
    <div
      className={`bg-canvas border-border-subtle duration-panel ease-standard flex shrink-0 overflow-hidden transition-[width] motion-reduce:transition-none ${
        collapsed ? 'w-0' : 'border-r-hairline w-48'
      } ${NO_GRAPH_KEYS}`}
    >
      <div
        inert={collapsed}
        aria-hidden={collapsed}
        className={`duration-panel ease-standard min-w-0 flex-1 overflow-x-hidden overflow-y-auto transition-opacity motion-reduce:transition-none ${
          collapsed ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <div className="w-48 px-2 py-2">
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
    </div>
  )
}

/**
 * Opens and closes the block browser. It sits in the canvas's top-left
 * corner, so it rides the browser's edge as the browser slides out and back.
 * A miss lands on the canvas rather than outside the tile, where a click would
 * close the editor or raise the unsaved-changes prompt. The box is shut while
 * the browser is closed and open while it is out.
 */
export function PaletteToggle() {
  const { settings, update } = useSettingsStore()
  const collapsed = settings.schedulerPaletteCollapsed
  const label = collapsed ? 'Open blocks' : 'Close blocks'
  return (
    <button
      type="button"
      // Swallowed: `update` reverts the setting itself on a refused write.
      onClick={() => update({ schedulerPaletteCollapsed: !collapsed }).catch(() => {})}
      title={label}
      aria-label={label}
      aria-expanded={!collapsed}
      className={`bg-surface border-border-subtle hover:bg-hover hover:text-text-primary border-hairline absolute top-2 left-2 z-10 flex h-7 w-7 items-center justify-center rounded transition-colors ${
        collapsed ? 'text-text-muted' : 'text-text-primary'
      } ${NO_GRAPH_KEYS}`}
    >
      <Icon icon={collapsed ? Package : PackageOpen} size="sm" />
    </button>
  )
}
