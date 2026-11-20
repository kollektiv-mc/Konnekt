import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import { models } from '../../../wailsjs/go/models'
import { ModSourcesPane } from './ModSourcesPane'

vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../../wailsjs/runtime/runtime')

afterEach(cleanup)

function status(keySet: boolean) {
  return models.CurseForgeStatus.createFrom({ keySet, builtIn: false })
}

describe('ModSourcesPane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.ModCurseForgeStatus).mockResolvedValue(status(false))
  })

  it('saves a pasted key and empties the field', async () => {
    vi.mocked(App.ModSetCurseForgeKey).mockImplementation(async () => {
      vi.mocked(App.ModCurseForgeStatus).mockResolvedValue(status(true))
    })
    const { getByLabelText, getByRole, findByText } = render(<ModSourcesPane />)
    await findByText('Not set')

    const input = getByLabelText('CurseForge API key') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'abc123' } })
    fireEvent.click(getByRole('button', { name: 'Save' }))

    await findByText('Set')
    expect(App.ModSetCurseForgeKey).toHaveBeenCalledWith('abc123')
    expect(input.value).toBe('')
    expect(getByRole('button', { name: 'Remove' })).toBeTruthy()
  })

  it('shows why a key was refused and keeps it in the field', async () => {
    vi.mocked(App.ModSetCurseForgeKey).mockRejectedValue(
      'curseforge: the API key was refused (HTTP 403)',
    )
    const { getByLabelText, getByRole, findByRole } = render(<ModSourcesPane />)
    const input = getByLabelText('CurseForge API key') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'wrong' } })
    fireEvent.click(getByRole('button', { name: 'Save' }))

    expect((await findByRole('alert')).textContent).toContain('refused')
    expect(input.value).toBe('wrong')
  })

  it('removes a saved key', async () => {
    vi.mocked(App.ModCurseForgeStatus).mockResolvedValue(status(true))
    vi.mocked(App.ModClearCurseForgeKey).mockImplementation(async () => {
      vi.mocked(App.ModCurseForgeStatus).mockResolvedValue(status(false))
    })
    const { findByRole, findByText } = render(<ModSourcesPane />)
    fireEvent.click(await findByRole('button', { name: 'Remove' }))
    await findByText('Not set')
    await waitFor(() => expect(App.ModClearCurseForgeKey).toHaveBeenCalled())
  })
})
