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
    expect(screen.getByText(/next time Konnekt starts/)).toBeTruthy()
    expect(pressed()).toBe('On')
  })

  it('shows and writes the stored policy', async () => {
    platform('linux')
    const onChange = vi.fn()
    render(<WebviewGpuSetting value="ondemand" onChange={onChange} />)
    await settle()
    expect(pressed()).toBe('On demand')
    fireEvent.click(screen.getByRole('button', { name: 'Off' }))
    expect(onChange).toHaveBeenCalledWith('never')
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
