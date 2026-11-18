import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react'
import { TOOLTIP_DELAY_MS } from '../../../components/ui/Tooltip'
import { KommandsPanel } from './KommandsPanel'
import type { KommandsSavedCommand, KommandsStatus } from '../../../stores/useCommandsStore'

vi.mock('../../../stores/useCommandsStore', () => ({
  useCommandsStore: (select: (s: { refreshKommands: () => Promise<void> }) => unknown) =>
    select({ refreshKommands: async () => {} }),
}))

const status = {
  installed: true,
  unsupported: false,
  error: '',
  savedCount: 1,
  brokenCount: 0,
  version: 1,
  path: '/home/user/.local/share/Kommands/konnekt-link.json',
} as unknown as KommandsStatus

const saved = [
  { id: 's1', label: 'Spawn', command: 'execute in minecraft:overworld run tp @s 0 100 0' },
] as unknown as KommandsSavedCommand[]

function hover(el: HTMLElement) {
  fireEvent.pointerEnter(el)
  act(() => {
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS)
  })
}

describe('KommandsPanel truncated text', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows the whole saved command in a tooltip', () => {
    render(<KommandsPanel status={status} saved={saved} items={[]} onAdd={() => {}} />)
    hover(screen.getByText(saved[0].command))
    expect(screen.getByRole('tooltip').textContent).toBe(saved[0].command)
  })

  it('shows the shared file path on the heading', () => {
    render(<KommandsPanel status={status} saved={saved} items={[]} onAdd={() => {}} />)
    hover(screen.getByText('Kommands'))
    expect(screen.getByRole('tooltip').textContent).toBe(status.path)
  })
})
