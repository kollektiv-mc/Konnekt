import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { CopyButton } from './CopyButton'

const label = (name: string) => screen.getByRole('button', { name })

describe('CopyButton', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    writeText = vi.fn(() => Promise.resolve())
    Object.assign(navigator, { clipboard: { writeText } })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const click = async (name = 'Copy') => {
    await act(async () => {
      fireEvent.click(label(name))
    })
  }

  it('copies the text and reads "Copied", then "Copy" again after 1.5 s', async () => {
    render(<CopyButton text="https://example.test" />)
    await click()
    expect(writeText).toHaveBeenCalledWith('https://example.test')
    expect(label('Copied')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(1499)
    })
    expect(label('Copied')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(label('Copy')).toBeTruthy()
  })

  it('leaves the label alone when the clipboard refuses', async () => {
    writeText.mockImplementation(() => Promise.reject(new Error('denied')))
    render(<CopyButton text="x" />)
    await click()
    expect(writeText).toHaveBeenCalled()
    expect(label('Copy')).toBeTruthy()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('restarts the 1.5 s window on a second copy', async () => {
    render(<CopyButton text="x" />)
    await click()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    await click('Copied')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(label('Copied')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(label('Copy')).toBeTruthy()
  })

  it('clears its timer on unmount, so nothing updates afterwards', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = render(<CopyButton text="x" />)
    await click()
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(error).not.toHaveBeenCalled()
  })
})
