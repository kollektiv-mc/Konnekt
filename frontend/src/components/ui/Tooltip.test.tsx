import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react'
import { Tooltip, TOOLTIP_DELAY_MS } from './Tooltip'

const TEXT = 'Stops the server.'

function setup(text: string | null | undefined) {
  const onEnter = vi.fn()
  render(
    <Tooltip text={text}>
      <div data-testid="row" onPointerEnter={onEnter}>
        Row
      </div>
    </Tooltip>,
  )
  return { row: screen.getByTestId('row'), onEnter }
}

function hover(row: HTMLElement, ms = TOOLTIP_DELAY_MS) {
  fireEvent.pointerEnter(row)
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows nothing before the delay has passed', () => {
    const { row } = setup(TEXT)
    hover(row, TOOLTIP_DELAY_MS - 1)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('shows the text as a tooltip once the delay has passed', () => {
    const { row } = setup(TEXT)
    hover(row)
    expect(screen.getByRole('tooltip').textContent).toBe('Stops the server.')
  })

  it('portals the card to body, outside the anchor tree', () => {
    const { row } = setup(TEXT)
    hover(row)
    expect(screen.getByRole('tooltip').parentElement).toBe(document.body)
  })

  it('does not intercept the pointer', () => {
    const { row } = setup(TEXT)
    hover(row)
    expect(screen.getByRole('tooltip').className).toContain('pointer-events-none')
  })

  it('hides on pointer leave and does not show a late timer', () => {
    const { row } = setup(TEXT)
    hover(row)
    fireEvent.pointerLeave(row)
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.pointerEnter(row)
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 1)
    })
    fireEvent.pointerLeave(row)
    act(() => {
      vi.advanceTimersByTime(10)
    })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('restarts the delay on each entry', () => {
    const { row } = setup(TEXT)
    fireEvent.pointerEnter(row)
    act(() => {
      vi.advanceTimersByTime(600)
    })
    fireEvent.pointerLeave(row)
    hover(row, 600)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it.each([
    ['pointerdown', () => fireEvent.pointerDown(document.body)],
    ['Escape', () => fireEvent.keyDown(document.body, { key: 'Escape' })],
    ['wheel', () => fireEvent.wheel(document.body)],
    ['dragstart', () => fireEvent.dragStart(document.body)],
    ['document scroll', () => fireEvent.scroll(document)],
  ])('hides on %s', (_name, act_) => {
    const { row } = setup(TEXT)
    hover(row)
    act(() => {
      act_()
    })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('cancels a pending tooltip on pointerdown', () => {
    const { row } = setup(TEXT)
    fireEvent.pointerEnter(row)
    fireEvent.pointerDown(row)
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS)
    })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('hides when the anchor scrolls, but not for an unrelated scroller', () => {
    const { row } = setup(TEXT)
    const elsewhere = document.createElement('div')
    document.body.appendChild(elsewhere)
    hover(row)

    fireEvent.scroll(elsewhere)
    expect(screen.getByRole('tooltip')).toBeTruthy()

    fireEvent.scroll(document.body)
    expect(screen.queryByRole('tooltip')).toBeNull()
    elsewhere.remove()
  })

  it('ignores other keys', () => {
    const { row } = setup(TEXT)
    hover(row)
    fireEvent.keyDown(document.body, { key: 'a' })
    expect(screen.getByRole('tooltip')).toBeTruthy()
  })

  it('points aria-describedby at the card only while it is shown', () => {
    const { row } = setup(TEXT)
    expect(row.getAttribute('aria-describedby')).toBeNull()
    hover(row)
    expect(row.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id)
    fireEvent.pointerLeave(row)
    expect(row.getAttribute('aria-describedby')).toBeNull()
  })

  it('keeps the anchor own pointer handler and describedby', () => {
    const onEnter = vi.fn()
    render(
      <Tooltip text="tip">
        <div data-testid="row" aria-describedby="other" onPointerEnter={onEnter} />
      </Tooltip>,
    )
    const row = screen.getByTestId('row')
    hover(row)
    expect(onEnter).toHaveBeenCalledTimes(1)
    expect(row.getAttribute('aria-describedby')).toBe(`other ${screen.getByRole('tooltip').id}`)
  })

  it.each([[''], [null], [undefined]])('renders nothing for text %j', (text) => {
    const add = vi.spyOn(window, 'addEventListener')
    const { row } = setup(text)
    hover(row)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(row.hasAttribute('aria-describedby')).toBe(false)
    expect(add.mock.calls.filter(([type]) => type === 'pointerdown')).toHaveLength(0)
    add.mockRestore()
  })

  it('removes its listeners once dismissed', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { row } = setup(TEXT)
    hover(row)
    fireEvent.pointerLeave(row)
    const removed = remove.mock.calls.map(([type]) => type)
    expect(removed).toEqual(expect.arrayContaining(['pointerdown', 'wheel', 'scroll', 'keydown']))
    remove.mockRestore()
  })
})
