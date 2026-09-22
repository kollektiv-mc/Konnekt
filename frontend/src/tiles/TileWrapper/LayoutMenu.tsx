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
  /** Absent for a tile that cannot maximize; the entry is left out. */
  onMaximize?: () => void
  onRemove: () => void
  onClose: () => void
}

/**
 * The menu a right-click on a tile's header opens, at the pointer.
 *
 * "Layout" first, with the three in-tile layouts as its fly-out, then the two
 * actions the header's buttons already offer, Maximize and Remove, so the
 * menu is a full set of what can be done to the tile from one gesture. The
 * fly-out opens on hover, like any other. The rows follow `Combobox`'s option
 * shape, a check that is invisible until chosen, so the two menus read as one
 * control.
 */
export function TileContextMenu({ at, layout, onChoose, onMaximize, onRemove, onClose }: Props) {
  return (
    <ContextMenu
      at={at}
      label="Tile"
      onClose={onClose}
      items={[
        {
          id: 'layout',
          label: 'Layout',
          children: TILE_LAYOUTS.map((option) => ({
            id: option,
            label: LABELS[option],
            checked: option === layout,
            onSelect: () => onChoose(option),
          })),
        },
        ...(onMaximize ? [{ id: 'maximize', label: 'Maximize', onSelect: onMaximize }] : []),
        { id: 'remove', label: 'Remove', onSelect: onRemove },
      ]}
    />
  )
}
