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

  // Both swallow: `update` reverts the collapse state itself, so the panel
  // springs back on a refused write and the settings modal shows why.
  function toggleCollapsed() {
    update({ schedulerPaletteCollapsed: !collapsed }).catch(() => {})
  }

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
      <div
        key={def.id}
        draggable
        onClick={() => onAdd(def)}
        onDragStart={(e) => e.dataTransfer.setData('blockType', def.id)}
        title={def.description}
        className={`bg-surface border-border-subtle text-text-primary border-hairline text-1xs mb-0.5 cursor-pointer rounded px-2 py-1 font-mono select-none ${indented ? 'ml-3' : ''}`}
        onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = color)}
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-subtle)')
        }
      >
        {def.label}
      </div>
    )
  }

  // One shell for both states, so collapsing and expanding animate its width
  // rather than swapping one element for another. The list keeps a fixed width
  // inside it, so the text is clipped by the narrowing shell instead of
  // reflowing, and it fades as it goes. Collapsed, it stays mounted but inert,
  // out of the tab order and the accessibility tree. The edge strip is the
  // shell's last child either way, the full height, on the right.
  return (
    <div
      className={`bg-canvas border-border-subtle border-r-hairline duration-panel ease-standard flex shrink-0 overflow-hidden transition-[width] motion-reduce:transition-none ${
        collapsed ? 'w-5' : 'w-48'
      } ${NO_GRAPH_KEYS}`}
    >
      <div
        inert={collapsed}
        aria-hidden={collapsed}
        className={`duration-panel ease-standard min-w-0 flex-1 overflow-x-hidden overflow-y-auto transition-opacity motion-reduce:transition-none ${
          collapsed ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <div className="w-[calc(12rem-1.25rem)] px-2 py-2">
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
                          className="text-text-secondary border-border-subtle hover:bg-hover border-hairline text-1xs mb-0.5 flex w-full cursor-pointer items-center gap-1 rounded border-dashed bg-transparent px-2 py-1 text-left font-mono transition-colors select-none"
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
      <button
        type="button"
        onClick={toggleCollapsed}
        title={collapsed ? 'Expand blocks' : 'Collapse blocks'}
        aria-label={collapsed ? 'Expand blocks' : 'Collapse blocks'}
        className="hover:bg-hover text-text-faint text-1xs flex w-5 shrink-0 cursor-pointer items-center justify-center font-mono transition-colors select-none"
      >
        {collapsed ? '›' : '‹'}
      </button>
    </div>
  )
}
