import { ContextMenu, type MenuPosition } from '../../components/ui/ContextMenu'
import { TILE_LAYOUTS, type TileLayout } from '../../types'

const LABELS: Record<TileLayout, string> = {
  detailed: 'Detailed',
  default: 'Default',
  expanded: 'Expanded',
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
 * the layouts down a list. The fly-out opens on hover, like any other, so it
 * behaves the same once it has siblings. The rows follow `Combobox`'s option
 * shape, a check that is invisible until chosen, so the two menus read as one
 * control; the Layout row's hint is the current choice.
 */
export function TileContextMenu({ at, layout, onChoose, onClose }: Props) {
  return (
    <ContextMenu
      at={at}
      label="Tile"
      onClose={onClose}
      items={[
        {
          id: 'layout',
          label: 'Layout',
          hint: LABELS[layout],
          children: TILE_LAYOUTS.map((option) => ({
            id: option,
            label: LABELS[option],
            checked: option === layout,
            onSelect: () => onChoose(option),
          })),
        },
      ]}
    />
  )
}
