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
  privateLink: false,
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

// The snapshot block's destination is optional: none means the staging folder's own index.
const snapshotDef = models.BlockDef.createFrom({
  id: 'action.dhSnapshot',
  category: 'action',
  label: 'DH Snapshot',
  description: 'Stops the server to copy its Distant Horizons data.',
  controlInputs: ['trigger'],
  controlOutputs: ['onComplete', 'onFailed'],
  configSchema: [
    { key: 'destination', label: 'Destination of the last snapshot', type: 'destination' },
  ],
})

function renderPanel(
  config: Record<string, unknown>,
  onChange = vi.fn(),
  def: models.BlockDef = uploadDef,
) {
  const data = { blockType: def.id, config } as unknown as NodeData
  render(<NodeConfigPanel nodeId="n1" data={data} def={def} edges={[]} onChange={onChange} />)
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

describe('NodeConfigPanel optional destination field', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDestinationsStore.setState({ destinations: [], loaded: false, loading: false, error: null })
    vi.mocked(App.ListDestinations).mockResolvedValue([dest()])
  })

  it('offers None first and shows it while nothing is chosen', async () => {
    renderPanel({}, vi.fn(), snapshotDef)
    const box = screen.getByRole('combobox', { name: 'Destination of the last snapshot' })
    expect(box.textContent).toContain('None')
    await waitFor(() => expect(useDestinationsStore.getState().loaded).toBe(true))
    expect(screen.queryByRole('alert')).toBeNull()

    fireEvent.click(box)
    const names = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(names).toEqual(['None', 'R2 snapshots'])
  })

  it('clears a chosen destination by picking None', async () => {
    const onChange = renderPanel({ destination: 'R2 snapshots' }, vi.fn(), snapshotDef)
    fireEvent.click(
      await screen.findByRole('combobox', { name: 'Destination of the last snapshot' }),
    )
    fireEvent.click(screen.getByRole('option', { name: 'None' }))
    expect(onChange).toHaveBeenCalledWith('destination', '')
  })

  it('still warns about a chosen destination that no longer exists', async () => {
    renderPanel({ destination: 'Old bucket' }, vi.fn(), snapshotDef)
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('does not offer None on a block that requires a destination', async () => {
    renderPanel({ destination: '' })
    fireEvent.click(screen.getByRole('combobox', { name: 'Destination' }))
    const names = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(names).not.toContain('None')
  })
})

// A def shaped like Condition's: an operator, two values on one row, and two
// checkboxes on the next that only a gate operator shows.
const gateWhen = { key: 'op', values: ['and', 'or'] }
const layoutDef = models.BlockDef.createFrom({
  id: 'control.layout',
  category: 'control',
  label: 'Layout',
  description: 'Fields that declare a row and a condition.',
  configSchema: [
    {
      key: 'op',
      label: 'Operator',
      type: 'select',
      default: 'eq',
      options: [
        { label: '==', value: 'eq' },
        { label: 'AND', value: 'and' },
        { label: 'OR', value: 'or' },
      ],
    },
    { key: 'left', label: 'A', type: 'string', row: 'values' },
    { key: 'right', label: 'B', type: 'string', row: 'values' },
    {
      key: 'leftTrue',
      label: 'is true',
      type: 'bool',
      default: true,
      showWhen: gateWhen,
      row: 'truth',
    },
    {
      key: 'rightTrue',
      label: 'is true',
      type: 'bool',
      default: true,
      showWhen: gateWhen,
      row: 'truth',
    },
  ],
})

describe('NodeConfigPanel showWhen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('hides a field while the field it names has another value', () => {
    renderPanel({ op: 'eq' }, vi.fn(), layoutDef)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByText('is true')).toBeNull()
  })

  it('shows it once the named field has a listed value', () => {
    renderPanel({ op: 'and' }, vi.fn(), layoutDef)
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getAllByText('is true')).toHaveLength(2)
  })

  it('reads the named field default when nothing is stored for it', () => {
    renderPanel({}, vi.fn(), layoutDef)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)

    cleanup()
    const gateByDefault = models.BlockDef.createFrom({
      ...layoutDef,
      configSchema: layoutDef.configSchema.map((f) =>
        f.key === 'op' ? { ...f, default: 'or' } : f,
      ),
    })
    renderPanel({}, vi.fn(), gateByDefault)
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('draws a checkbox from the stored value and reports a change', () => {
    const onChange = renderPanel({ op: 'or', leftTrue: false }, vi.fn(), layoutDef)
    const [left, right] = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(left.checked).toBe(false)
    expect(right.checked).toBe(true)

    fireEvent.click(left)
    expect(onChange).toHaveBeenCalledWith('leftTrue', true)
  })

  it('writes nothing for a hidden field when another is edited', () => {
    const onChange = renderPanel({ op: 'eq', left: 'x', leftTrue: false }, vi.fn(), layoutDef)
    fireEvent.change(screen.getByDisplayValue('x'), { target: { value: 'y' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('left', 'y')
  })

  it('shows every field of a def that declares no condition', () => {
    renderPanel({ destination: 'a', source: 'b' })
    expect(screen.getByDisplayValue('b')).toBeTruthy()
  })
})

describe('NodeConfigPanel row', () => {
  beforeEach(() => vi.clearAllMocks())

  const rowOf = (el: HTMLElement) => el.closest('[data-row]')

  it('puts consecutive fields with the same row in one line', () => {
    renderPanel({ op: 'and', left: 'x', right: 'y' }, vi.fn(), layoutDef)
    const left = rowOf(screen.getByDisplayValue('x'))
    const right = rowOf(screen.getByDisplayValue('y'))
    expect(left).not.toBeNull()
    expect(left).toBe(right)
    expect(left?.getAttribute('data-row')).toBe('values')
    expect(left?.className).toContain('grid-flow-col')
    expect(left?.className).toContain('auto-cols-fr')
  })

  it('puts the checkboxes in a line of their own, under the values', () => {
    renderPanel({ op: 'and', left: 'x', right: 'y' }, vi.fn(), layoutDef)
    const [a, b] = screen.getAllByRole('checkbox')
    expect(rowOf(a)).toBe(rowOf(b))
    expect(rowOf(a)?.getAttribute('data-row')).toBe('truth')
    expect(rowOf(a)).not.toBe(rowOf(screen.getByDisplayValue('x')))

    const lines = Array.from(document.querySelectorAll('[data-row]')).map((n) =>
      n.getAttribute('data-row'),
    )
    expect(lines).toEqual(['values', 'truth'])
  })

  it('keeps a field with no row on a line of its own', () => {
    renderPanel({ op: 'eq', left: 'x', right: 'y' }, vi.fn(), layoutDef)
    expect(rowOf(screen.getByRole('combobox', { name: 'Operator' }))).toBeNull()
  })

  it('labels each value and shows the checkboxes beside their labels', () => {
    renderPanel({ op: 'and' }, vi.fn(), layoutDef)
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.getByText('B')).toBeTruthy()
  })

  it('does not join two separate runs that share a row name', () => {
    const def = models.BlockDef.createFrom({
      ...layoutDef,
      configSchema: [
        { key: 'a', label: 'One', type: 'string', row: 'r' },
        { key: 'b', label: 'Two', type: 'string' },
        { key: 'c', label: 'Three', type: 'string', row: 'r' },
      ],
    })
    renderPanel({ a: '1', b: '2', c: '3' }, vi.fn(), def)
    expect(rowOf(screen.getByDisplayValue('1'))).not.toBe(rowOf(screen.getByDisplayValue('3')))
    expect(rowOf(screen.getByDisplayValue('2'))).toBeNull()
  })

  it('closes the gap when a hidden field sat between two of one row', () => {
    const def = models.BlockDef.createFrom({
      ...layoutDef,
      configSchema: [
        { key: 'op', label: 'Operator', type: 'select', default: 'eq', options: [] },
        { key: 'a', label: 'One', type: 'string', row: 'r' },
        {
          key: 'h',
          label: 'Hidden',
          type: 'string',
          row: 'r',
          showWhen: { key: 'op', values: ['x'] },
        },
        { key: 'c', label: 'Three', type: 'string', row: 'r' },
      ],
    })
    renderPanel({ a: '1', c: '3' }, vi.fn(), def)
    expect(rowOf(screen.getByDisplayValue('1'))).toBe(rowOf(screen.getByDisplayValue('3')))
  })
})
