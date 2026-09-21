import { Popover } from '../../components/ui/Popover'
import { Icon } from '../../components/ui/Icon'
import { Check } from '../../lib/icons'
import { TILE_LAYOUTS, type TileLayout } from '../../types'

const LABELS: Record<TileLayout, { label: string; hint: string }> = {
  compact: { label: 'Compact', hint: 'The key figure only' },
  default: { label: 'Default', hint: 'Key figure large, detail below' },
  large: { label: 'Large', hint: 'Key figure small, more detail' },
}

interface Props {
  open: boolean
  layout: TileLayout
  onChoose: (layout: TileLayout) => void
  onClose: () => void
}

/**
 * The menu a right-click on a tile's header opens: which of the three in-tile
 * layouts the compact face shows.
 *
 * A `Popover` under the header rather than a menu at the pointer: the header
 * is the thing that was clicked and is 33px tall, so the two positions are a
 * few pixels apart, and the popover already carries the open animation, the
 * backdrop that closes it and the layer it sits on. The rows follow
 * `Combobox`'s option shape, a check that is invisible until chosen, so the
 * two menus read as one control.
 */
export function LayoutMenu({ open, layout, onChoose, onClose }: Props) {
  return (
    <Popover open={open} onClose={onClose} align="left" width={200}>
      <div role="menu" aria-label="Tile layout" className="py-1">
        {TILE_LAYOUTS.map((option) => {
          const selected = option === layout
          return (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              onClick={() => {
                onChoose(option)
                onClose()
              }}
              className={`hover:bg-hover flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left transition-colors ${
                selected ? 'text-accent' : 'text-text-primary'
              }`}
            >
              <Icon
                icon={Check}
                size="xs"
                className={`text-accent ${selected ? 'opacity-100' : 'opacity-0'}`}
              />
              <span className="flex min-w-0 flex-col">
                <span className="text-xs">{LABELS[option].label}</span>
                <span className="text-text-faint text-2xs">{LABELS[option].hint}</span>
              </span>
            </button>
          )
        })}
      </div>
    </Popover>
  )
}
