import { ControlButton, Controls, useReactFlow, useStore } from '@xyflow/react'
import { Icon } from '../../../components/ui/Icon'
import { Fullscreen, Minus, Plus } from '../../../lib/icons'

/**
 * The canvas's zoom and fit-view buttons, drawn here rather than by xyflow's
 * `<Controls>` defaults, which set each button's `title` to its label. Konnekt
 * shows no native WebView tooltips (the `title` rule in `eslint.config.js`), so
 * the panel and its styling stay xyflow's and the buttons are ours, named by
 * `aria-label` alone. Same actions, same disabled limits as the defaults.
 */
export function CanvasControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const atMax = useStore((s) => s.transform[2] >= s.maxZoom)
  const atMin = useStore((s) => s.transform[2] <= s.minZoom)
  return (
    <Controls showZoom={false} showFitView={false} showInteractive={false}>
      <ControlButton
        className="react-flow__controls-zoomin"
        onClick={() => void zoomIn()}
        disabled={atMax}
        aria-label="Zoom in"
      >
        <Icon icon={Plus} size="xs" />
      </ControlButton>
      <ControlButton
        className="react-flow__controls-zoomout"
        onClick={() => void zoomOut()}
        disabled={atMin}
        aria-label="Zoom out"
      >
        <Icon icon={Minus} size="xs" />
      </ControlButton>
      <ControlButton
        className="react-flow__controls-fitview"
        onClick={() => void fitView()}
        aria-label="Fit view"
      >
        <Icon icon={Fullscreen} size="xs" />
      </ControlButton>
    </Controls>
  )
}
