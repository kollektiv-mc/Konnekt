import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useSortable } from './useSortable'

afterEach(cleanup)

/** Three rows in a column, each 20px tall with a 4px gap, as a real list lays out. */
function boxAt(i: number) {
  return {
    x: 0,
    y: i * 24,
    width: 200,
    height: 20,
    top: i * 24,
    left: 0,
    right: 200,
    bottom: i * 24 + 20,
  }
}

function List({
  onMove,
  disabled = false,
}: {
  onMove: (from: number, to: number) => void
  disabled?: boolean
}) {
  const labels = ['A', 'B', 'C']
  const sortable = useSortable({ count: labels.length, axis: 'y', disabled, onMove })
  return (
    <div>
      {labels.map((label, i) => (
        <div
          key={label}
          data-testid={`row-${label}`}
          ref={(el) => {
            if (el) el.getBoundingClientRect = () => boxAt(i) as DOMRect
            sortable.rowRef(i)(el)
          }}
          data-shift={JSON.stringify(sortable.shift(i))}
          data-lifted={sortable.drag?.from === i ? 'yes' : 'no'}
        >
          <button {...sortable.handleProps(i)} aria-label={`Reorder ${label}`} />
          {label}
        </div>
      ))}
    </div>
  )
}

/** jsdom's pointer events carry no coordinates; a MouseEvent with the pointer fields does. */
function pointer(type: string, el: Element, x: number, y: number) {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  fireEvent(el, e)
}

describe('useSortable', () => {
  it('lifts a row past the threshold, marks the slot, and moves on release', () => {
    const onMove = vi.fn()
    render(<List onMove={onMove} />)
    const handle = screen.getByRole('button', { name: 'Reorder A' })

    pointer('pointerdown', handle, 5, 5)
    // A press that barely moves is a click, not a drag: nothing lifts.
    pointer('pointermove', handle, 6, 7)
    expect(screen.getByTestId('row-A').dataset.lifted).toBe('no')

    // Down to the lower half of the last row: after everything. B and C each
    // slide up one position to open the gap at the end, where A will land.
    pointer('pointermove', handle, 5, 65)
    expect(screen.getByTestId('row-A').dataset.lifted).toBe('yes')
    expect(screen.getByTestId('row-B').dataset.shift).toBe('{"dx":0,"dy":-24}')
    expect(screen.getByTestId('row-C').dataset.shift).toBe('{"dx":0,"dy":-24}')

    pointer('pointerup', handle, 5, 65)
    expect(onMove).toHaveBeenCalledWith(0, 2)
    expect(screen.getByTestId('row-A').dataset.lifted).toBe('no')
    expect(screen.getByTestId('row-C').dataset.shift).toBe('null')
  })

  it('moves nothing aside where releasing would change nothing', () => {
    const onMove = vi.fn()
    render(<List onMove={onMove} />)
    const handle = screen.getByRole('button', { name: 'Reorder B' })
    pointer('pointerdown', handle, 5, 29)
    // Over the top half of the row below B: the slot is B's own next slot.
    pointer('pointermove', handle, 5, 50)
    expect(screen.getByTestId('row-C').dataset.shift).toBe('null')
    expect(screen.getByTestId('row-A').dataset.shift).toBe('null')
    pointer('pointerup', handle, 5, 50)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('slides the rows above a lifted row down when it is dragged up', () => {
    const onMove = vi.fn()
    render(<List onMove={onMove} />)
    const handle = screen.getByRole('button', { name: 'Reorder C' })
    pointer('pointerdown', handle, 5, 53)
    // Into the top half of A: before everything.
    pointer('pointermove', handle, 5, 4)
    expect(screen.getByTestId('row-A').dataset.shift).toBe('{"dx":0,"dy":24}')
    expect(screen.getByTestId('row-B').dataset.shift).toBe('{"dx":0,"dy":24}')
    pointer('pointerup', handle, 5, 4)
    expect(onMove).toHaveBeenCalledWith(2, 0)
  })

  it('moves one step with the arrow keys and stops at the ends', () => {
    const onMove = vi.fn()
    render(<List onMove={onMove} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder B' }), { key: 'ArrowUp' })
    expect(onMove).toHaveBeenLastCalledWith(1, 0)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder C' }), { key: 'ArrowDown' })
    expect(onMove).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder C' }), { key: 'Enter' })
    expect(onMove).toHaveBeenCalledTimes(1)
  })

  it('does nothing while disabled', () => {
    const onMove = vi.fn()
    render(<List onMove={onMove} disabled />)
    const handle = screen.getByRole('button', { name: 'Reorder A' })
    pointer('pointerdown', handle, 5, 5)
    pointer('pointermove', handle, 5, 65)
    pointer('pointerup', handle, 5, 65)
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(onMove).not.toHaveBeenCalled()
    expect(screen.getByTestId('row-A').dataset.lifted).toBe('no')
  })
})
