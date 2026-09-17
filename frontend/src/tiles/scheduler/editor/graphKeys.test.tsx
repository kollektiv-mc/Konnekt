import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { models } from '../../../../wailsjs/go/models'
import { BlockPalette } from './BlockPalette'
import { QuickAddMenu } from './QuickAddMenu'
import { Combobox } from '../../../components/ui/Combobox'
import { NO_GRAPH_KEYS } from './blockMeta'

vi.mock('../../../../wailsjs/go/main/App')
vi.mock('../../../../wailsjs/runtime/runtime', () => ({
  BrowserOpenURL: vi.fn(),
  EventsOn: vi.fn(() => () => {}),
}))

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(cleanup)

// ─── Backspace must not delete the node being edited (#159) ─────────────────
//
// React Flow binds its delete key to the document rather than to the canvas,
// and the only thing that stops it acting is `isInputDOMNode`. This mirrors
// that check as @xyflow/system 0.0.82 implements it; the package is a
// transitive dependency and is not importable from here, so the rule is
// restated rather than imported, and this comment is the pin.
//
// The shape that matters: a BUTTON is not an input, so a control built from one
// gets no protection from the library. Since #160 the panel's preset fields are
// buttons where they used to be native selects, and the panel is showing the
// selected node.
const INPUT_TAGS = ['INPUT', 'SELECT', 'TEXTAREA']
const reactFlowIgnores = (el: Element): boolean =>
  INPUT_TAGS.includes(el.nodeName) ||
  el.hasAttribute('contenteditable') ||
  !!el.closest(`.${NO_GRAPH_KEYS}`)

const focusable = (root: ParentNode): Element[] =>
  Array.from(root.querySelectorAll('button, a, input, textarea, select, [tabindex]'))

const defs = [
  { id: 'action.command', category: 'action', label: 'Command', description: 'x' },
  { id: 'trigger.cron', category: 'trigger', label: 'Cron', description: 'y' },
] as unknown as models.BlockDef[]

describe('the editor chrome opts out of graph key handling', () => {
  it('is what saves a button, which the library itself would not', () => {
    // Stated directly, because it is the whole reason the class is needed: the
    // preset field's own element is not something React Flow skips.
    render(<Combobox value="a" onChange={() => {}} options={[{ value: 'a', label: 'A' }]} />)
    const control = screen.getByRole('combobox')

    expect(control.nodeName).toBe('BUTTON')
    expect(reactFlowIgnores(control)).toBe(false)

    cleanup()
    render(
      <div className={NO_GRAPH_KEYS}>
        <Combobox value="a" onChange={() => {}} options={[{ value: 'a', label: 'A' }]} />
      </div>,
    )
    expect(reactFlowIgnores(screen.getByRole('combobox'))).toBe(true)
  })

  it('covers everything in the block palette, focusable today or not', () => {
    const { container } = render(<BlockPalette blockDefs={defs} onAdd={() => {}} />)

    // The palette's rows are clickable divs, so nothing in it takes focus and
    // the opt-out is not load-bearing here yet. It is on the root anyway, so
    // the day a row becomes a button it is already covered rather than
    // silently deleting the selected node.
    const all = Array.from(container.querySelectorAll('*'))
    expect(all.length).toBeGreaterThan(0)
    for (const el of all) {
      expect(reactFlowIgnores(el)).toBe(true)
    }
    expect(focusable(container)).toHaveLength(0)
  })

  it('covers the quick-add menu, which is portaled outside the canvas', () => {
    render(
      <QuickAddMenu
        blockDefs={defs}
        screenPos={{ x: 10, y: 10 }}
        onPick={() => {}}
        onClose={() => {}}
      />,
    )

    // Portaled to body, so the search input and every result live outside the
    // editor's own subtree. Being elsewhere in the tree guards nothing when the
    // listener is on the document.
    const controls = focusable(document.body).filter((el) => el.closest('.z-popover'))
    expect(controls.length).toBeGreaterThan(0)
    for (const el of controls) {
      expect(reactFlowIgnores(el)).toBe(true)
    }
  })
})
