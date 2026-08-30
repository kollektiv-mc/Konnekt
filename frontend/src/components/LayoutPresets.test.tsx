import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import * as App from '../../wailsjs/go/main/App'
import { LayoutPresets } from './LayoutPresets'
import { useLayoutStore } from '../stores/useLayoutStore'

vi.mock('../../wailsjs/go/main/App')

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(cleanup)

const preset = (name: string) => ({ name, layout: '[]' })
const presetButton = (name: string) => screen.getByRole('button', { name })

// The list used to hand-roll hover with onMouseEnter/onMouseLeave writing
// element.style.background, guarded on `!== activePresetName`. Selecting a
// preset while hovering it left that inline grey in place, and an inline style
// outranks the class, so the *active* row rendered grey instead of accent. The
// matching mouse-leave then read the row as active, skipped the reset, and
// stranded the grey there permanently — one more stuck row per selection.
//
// Hence the assertions on the inline `style` attribute specifically: the classes
// were always right, and asserting only on them would have passed throughout the
// bug.
describe('LayoutPresets selection styling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.SaveActiveLayout).mockResolvedValue(undefined)
    useLayoutStore.setState({
      presets: [preset('Default'), preset('Compact'), preset('Wide')],
      activePresetName: 'Default',
      currentLayout: [],
      error: null,
    })
  })

  // Hover, select, and move away — the exact gesture that stranded the grey.
  function selectByHovering(name: string) {
    const button = presetButton(name)
    fireEvent.mouseEnter(button)
    fireEvent.click(button)
    fireEvent.mouseLeave(button)
  }

  it('gives the selected preset the accent treatment, not the hover grey', () => {
    render(<LayoutPresets />)
    selectByHovering('Compact')

    const active = presetButton('Compact')
    expect(active.className).toContain('bg-accent/10')
    expect(active.className).toContain('text-accent')
    expect(active.getAttribute('style')).toBeNull()
  })

  it('leaves no inline background behind as the selection moves', () => {
    render(<LayoutPresets />)

    selectByHovering('Compact')
    selectByHovering('Wide')
    selectByHovering('Default')

    for (const name of ['Default', 'Compact', 'Wide']) {
      expect(presetButton(name).getAttribute('style')).toBeNull()
    }
  })

  it('carries the accent on exactly one preset at a time', () => {
    render(<LayoutPresets />)

    selectByHovering('Compact')
    selectByHovering('Wide')

    const accented = ['Default', 'Compact', 'Wide'].filter((name) =>
      presetButton(name).className.includes('bg-accent/10'),
    )
    expect(accented).toEqual(['Wide'])
  })

  it('offers the grey hover to every preset that is not selected', () => {
    render(<LayoutPresets />)
    selectByHovering('Compact')

    expect(presetButton('Compact').className).not.toContain('hover:bg-hover')
    for (const name of ['Default', 'Wide']) {
      expect(presetButton(name).className).toContain('hover:bg-hover')
    }
  })
})
