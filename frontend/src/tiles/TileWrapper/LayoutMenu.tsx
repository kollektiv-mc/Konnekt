import { ContextMenu, type MenuPosition } from '../../components/ui/ContextMenu'
import { TILE_LAYOUTS, type TileLayout } from '../../types'

const LABELS: Record<TileLayout, { label: string; hint: string }> = {
  detailed: { label: 'Detailed', hint: 'Small figures, more rows' },
  default: { label: 'Default', hint: 'Key figure large, detail below' },
  expanded: { label: 'Expanded', hint: 'The key figure, spread out' },
}

interface Props {
  at: MenuPosition
  layout: TileLayout
  onChoose: (layout: TileLayout) => void
  onClose: () => void
}

/**
 * The menu a right-click on a tile's header opens, at the pointer.
 *
 * One entry today, "Layout", with the three in-tile layouts as its fly-out,
 * so the next entries the header grows slot in beside it rather than pushing
 * the layouts down a list. The fly-out is open from the first paint, since
 * asking for a hover before the only choice appears made the menu feel slow.
 * The rows follow `Combobox`'s option shape, a check that is invisible until
 * chosen, so the two menus read as one control.
 */
export function TileContextMenu({ at, layout, onChoose, onClose }: Props) {
  return (
    <ContextMenu
      at={at}
      label="Tile"
      onClose={onClose}
      openChild="layout"
      items={[
        {
          id: 'layout',
          label: 'Layout',
          hint: LABELS[layout].label,
          children: TILE_LAYOUTS.map((option) => ({
            id: option,
            label: LABELS[option].label,
            hint: LABELS[option].hint,
            checked: option === layout,
            onSelect: () => onChoose(option),
          })),
        },
      ]}
    />
  )
}
