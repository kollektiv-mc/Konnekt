import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as Runtime from '../../../wailsjs/runtime/runtime'
import { WebviewGpuSetting } from './WebviewGpuSetting'

vi.mock('../../../wailsjs/runtime/runtime')

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(cleanup)

const platform = (p: string) =>
  vi
    .mocked(Runtime.Environment)
    .mockResolvedValue({ buildType: 'production', platform: p, arch: 'amd64' })
const settle = () => act(async () => {})
const pressed = () =>
  screen.getAllByRole('button').find((b) => b.className.includes('bg-accent'))?.textContent

describe('WebviewGpuSetting', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is offered on Linux, at On when nothing was chosen', async () => {
    platform('linux')
    render(<WebviewGpuSetting value="" onChange={() => {}} />)
    await settle()
    expect(screen.getByText('Hardware acceleration')).toBeTruthy()
    expect(pressed()).toBe('On')
    expect(screen.queryByText(/next launch/)).toBeNull()
  })

  it('shows and writes the stored policy', async () => {
    platform('linux')
    const onChange = vi.fn()
    render(<WebviewGpuSetting value="ondemand" onChange={onChange} />)
    await settle()
    expect(pressed()).toBe('On demand')
    expect(screen.queryByText(/next launch/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Off' }))
    expect(onChange).toHaveBeenCalledWith('never')
    expect(screen.getByText('Applies on the next launch.')).toBeTruthy()
  })

  it.each(['windows', 'darwin', 'web'])('is hidden on %s, which ignores the policy', async (p) => {
    platform(p)
    const { container } = render(<WebviewGpuSetting value="" onChange={() => {}} />)
    await settle()
    expect(container.textContent).toBe('')
  })

  it('is hidden, without throwing, when there is no Wails runtime', async () => {
    vi.mocked(Runtime.Environment).mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'Environment')")
    })
    const { container } = render(<WebviewGpuSetting value="" onChange={() => {}} />)
    await settle()
    expect(container.textContent).toBe('')
  })
})
