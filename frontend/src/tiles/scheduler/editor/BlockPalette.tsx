import type { models } from '../../../../wailsjs/go/models'
import {
  CATEGORY_ICON,
  categoryColor,
  categoryTextClass,
  NO_GRAPH_KEYS,
  orderedCategories,
} from './blockMeta'
import { blockEntries, groupKey } from './blockGroups'
import { useSettingsStore } from '../../../stores/useSettingsStore'
import { Tooltip } from '../../../components/ui/Tooltip'
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
  const openGroups = settings.schedulerPaletteOpenGroups

  const categories = orderedCategories(blockDefs)

  // Swallowed: `update` reverts the setting itself on a refused write, and
  // the settings modal shows why.
  function toggleCategory(cat: string) {
    update({ schedulerPaletteClosedCategories: { ...closed, [cat]: !closed[cat] } }).catch(() => {})
  }

  function toggleGroup(key: string) {
    update({ schedulerPaletteOpenGroups: { ...openGroups, [key]: !openGroups[key] } }).catch(
      () => {},
    )
  }

  // One block row, for the category list and for the members of an open group
  // alike. The drag payload is the block's own id wherever the row sits, so a
  // grouped block lands on the canvas exactly like a loose one.
  function blockRow(def: models.BlockDef, color: string, indented: boolean) {
    return (
      <Tooltip key={def.id} text={def.description}>
        <div
          draggable
          onClick={() => onAdd(def)}
          onDragStart={(e) => e.dataTransfer.setData('blockType', def.id)}
          className={`bg-surface border-border-subtle text-text-primary border-hairline text-1xs mb-0.5 rounded px-2 py-1 font-mono select-none ${indented ? 'ml-3' : ''}`}
          onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = color)}
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-subtle)')
          }
        >
          {def.label}
        </div>
      </Tooltip>
    )
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
                  className={`mb-1 flex items-center gap-1 font-mono text-xs uppercase select-none ${textClass}`}
                  onClick={() => toggleCategory(cat)}
                >
                  <span className="text-3xs">{isClosed ? '▸' : '▾'}</span>
                  <span>{icon}</span>
                  <span>{cat}</span>
                </div>

                {!isClosed &&
                  blockEntries(defs).map((entry) => {
                    if (entry.kind === 'block') return blockRow(entry.def, color, false)
                    const key = groupKey(cat, entry.name)
                    const isOpen = !!openGroups[key]
                    // Dashed and transparent where a block row is solid, so a
                    // dropdown reads as a heading for the rows under it rather
                    // than as one more block to drag.
                    return (
                      <div key={key}>
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => toggleGroup(key)}
                          className="text-text-secondary border-border-subtle hover:bg-hover border-hairline text-1xs mb-0.5 flex w-full items-center gap-1 rounded border-dashed bg-transparent px-2 py-1 text-left font-mono transition-colors select-none"
                        >
                          <span className="text-3xs">{isOpen ? '▾' : '▸'}</span>
                          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                        </button>
                        {isOpen && entry.defs.map((def) => blockRow(def, color, true))}
                      </div>
                    )
                  })}
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
