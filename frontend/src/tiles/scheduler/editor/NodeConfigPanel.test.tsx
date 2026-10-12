import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import * as App from '../../../../wailsjs/go/main/App'
import { models } from '../../../../wailsjs/go/models'
import { useDestinationsStore } from '../../../stores/useDestinationsStore'
import type { Destination } from '../../../stores/useDestinationsStore'
import { NodeConfigPanel } from './NodeConfigPanel'
import type { NodeData } from './graphMapping'

vi.mock('../../../../wailsjs/go/main/App')

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(cleanup)

const dest = (over: Partial<Destination> = {}): Destination => ({
  id: 'd1',
  name: 'R2 snapshots',
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'snapshots',
  prefix: '',
  publicBaseUrl: '',
  accessKeyId: 'AKID',
  secretSet: true,
  ...over,
})

const uploadDef = models.BlockDef.createFrom({
  id: 'action.upload',
  category: 'action',
  label: 'Upload to Bucket',
  description: 'Uploads a folder.',
  controlInputs: ['trigger'],
  controlOutputs: ['onComplete', 'onFailed'],
  configSchema: [
    { key: 'destination', label: 'Destination', type: 'destination', required: true },
    { key: 'source', label: 'Source (file or folder)', type: 'string', required: true },
  ],
})

function renderPanel(config: Record<string, unknown>, onChange = vi.fn()) {
  const data = { blockType: 'action.upload', config } as unknown as NodeData
  render(<NodeConfigPanel nodeId="n1" data={data} def={uploadDef} edges={[]} onChange={onChange} />)
  return onChange
}

describe('NodeConfigPanel destination field', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDestinationsStore.setState({ destinations: [], loaded: false, loading: false, error: null })
    vi.mocked(App.ListDestinations).mockResolvedValue([
      dest(),
      dest({ id: 'd2', name: 'Backups bucket' }),
    ])
  })

  it('lists the saved destinations through the generated binding and chooses one by name', async () => {
    const onChange = renderPanel({ destination: '' })
    await waitFor(() => expect(App.ListDestinations).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('combobox', { name: 'Destination' }))
    const names = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(names).toEqual(['R2 snapshots', 'Backups bucket'])

    fireEvent.click(screen.getByRole('option', { name: 'Backups bucket' }))
    expect(onChange).toHaveBeenCalledWith('destination', 'Backups bucket')
  })

  it('shows the chosen destination and no warning when it exists', async () => {
    renderPanel({ destination: 'R2 snapshots' })
    expect((await screen.findByRole('combobox', { name: 'Destination' })).textContent).toContain(
      'R2 snapshots',
    )
    await waitFor(() => expect(useDestinationsStore.getState().loaded).toBe(true))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('matches a stored name ignoring case, as the backend does', async () => {
    renderPanel({ destination: 'r2 SNAPSHOTS' })
    await waitFor(() => expect(useDestinationsStore.getState().loaded).toBe(true))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps a destination that no longer exists and says so, rather than replacing it', async () => {
    renderPanel({ destination: 'Old bucket' })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('does not exist any more')
    expect(screen.getByRole('combobox', { name: 'Destination' }).textContent).toContain(
      'Old bucket (not found)',
    )
  })

  it('points at Settings when there are no destinations at all', async () => {
    vi.mocked(App.ListDestinations).mockResolvedValue([])
    renderPanel({ destination: '' })
    expect(await screen.findByText(/No destinations yet/)).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Destination' }).textContent).toContain(
      'Choose a destination',
    )
  })

  it('does not call a missing destination missing before the list has been read', () => {
    vi.mocked(App.ListDestinations).mockReturnValue(new Promise(() => {}))
    renderPanel({ destination: 'R2 snapshots' })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/No destinations yet/)).toBeNull()
  })

  it('still renders the other fields of the block as before', async () => {
    const onChange = renderPanel({ destination: 'R2 snapshots', source: 'world' })
    const source = screen.getByDisplayValue('world')
    fireEvent.change(source, { target: { value: 'world_nether' } })
    expect(onChange).toHaveBeenCalledWith('source', 'world_nether')
    await waitFor(() => expect(App.ListDestinations).toHaveBeenCalled())
  })
})
