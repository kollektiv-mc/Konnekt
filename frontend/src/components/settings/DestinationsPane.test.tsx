import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import { useDestinationsStore } from '../../stores/useDestinationsStore'
import type { Destination } from '../../stores/useDestinationsStore'
import { DestinationsPane } from './DestinationsPane'

vi.mock('../../../wailsjs/go/main/App')

afterEach(cleanup)

const SECRET = 'wJalrXUtnFEMI-typed-secret'

const dest = (over: Partial<Destination> = {}): Destination => ({
  id: 'd1',
  name: 'R2 snapshots',
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'snapshots',
  prefix: 'dh',
  publicBaseUrl: '',
  accessKeyId: 'AKID',
  secretSet: true,
  privateLink: false,
  ...over,
})

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

async function open(list: Destination[]) {
  vi.mocked(App.ListDestinations).mockResolvedValue(list)
  render(<DestinationsPane />)
  await screen.findByText(list.length ? list[0].name : 'No destination yet.')
}

describe('DestinationsPane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDestinationsStore.setState({ destinations: [], loaded: false, loading: false, error: null })
    vi.mocked(App.SaveDestination).mockImplementation(async (d) => d)
    vi.mocked(App.DeleteDestination).mockResolvedValue(undefined)
  })

  it('says there is no destination yet', async () => {
    await open([])
    expect(button('Add destination')).toBeTruthy()
  })

  it('lists a destination as saved without any secret in the page', async () => {
    await open([dest()])
    expect(screen.getByText('secret saved')).toBeTruthy()
    expect(screen.getByText(/snapshots at https:\/\/acct/)).toBeTruthy()
    expect(document.body.textContent).not.toContain(SECRET)
  })

  it('never pre-fills the secret field and says one is saved', async () => {
    await open([dest()])
    fireEvent.click(button('Edit R2 snapshots'))
    const field = input('Secret access key')
    expect(field.type).toBe('password')
    expect(field.value).toBe('')
    expect(field.placeholder).toBe('Saved')
    expect(screen.getByText(/A secret is saved\. Leave this blank to keep it\./)).toBeTruthy()
  })

  it('saves with a blank secret to keep the stored one, then closes the form', async () => {
    await open([dest()])
    fireEvent.click(button('Edit R2 snapshots'))
    fireEvent.change(input('Name'), { target: { value: 'Renamed' } })
    fireEvent.click(button('Save'))

    await waitFor(() => expect(App.SaveDestination).toHaveBeenCalledTimes(1))
    const [sent, secret] = vi.mocked(App.SaveDestination).mock.calls[0]
    expect(secret).toBe('')
    expect(sent.name).toBe('Renamed')
    await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull())
  })

  it('sends a typed secret as its own argument and clears the field', async () => {
    await open([dest()])
    fireEvent.click(button('Edit R2 snapshots'))
    fireEvent.change(input('Secret access key'), { target: { value: SECRET } })
    fireEvent.click(button('Save'))

    await waitFor(() => expect(App.SaveDestination).toHaveBeenCalledTimes(1))
    const [sent, secret] = vi.mocked(App.SaveDestination).mock.calls[0]
    expect(secret).toBe(SECRET)
    expect(JSON.stringify(sent)).not.toContain(SECRET)
    expect(JSON.stringify(useDestinationsStore.getState())).not.toContain(SECRET)
  })

  it('needs a secret for a new destination and defaults the region to auto', async () => {
    await open([])
    fireEvent.click(button('Add destination'))
    expect(input('Region').value).toBe('auto')
    fireEvent.change(input('Name'), { target: { value: 'New' } })
    fireEvent.change(input('Endpoint'), { target: { value: 'https://h.example.com' } })
    fireEvent.change(input('Bucket'), { target: { value: 'b' } })
    fireEvent.change(input('Access key ID'), { target: { value: 'AK' } })
    expect(button('Save').disabled).toBe(true)
    expect(button('Test').disabled).toBe(true)
    fireEvent.change(input('Secret access key'), { target: { value: SECRET } })
    expect(button('Save').disabled).toBe(false)
  })

  it('keeps the form open and shows the refusal when a save fails', async () => {
    vi.mocked(App.SaveDestination).mockRejectedValue(
      new Error('a destination named "x" already exists'),
    )
    await open([dest()])
    fireEvent.click(button('Edit R2 snapshots'))
    fireEvent.click(button('Save'))
    expect((await screen.findByRole('alert')).textContent).toContain('already exists')
    expect(input('Name').value).toBe('R2 snapshots')
  })

  it('shows the verdict of a test, and the unsaved form is what is tested', async () => {
    vi.mocked(App.TestDestination).mockResolvedValue({
      ok: false,
      status: 'credentials',
      message: 'Wrong credentials: acct refused the access key or secret (403).',
    })
    await open([dest()])
    fireEvent.click(button('Edit R2 snapshots'))
    fireEvent.change(input('Bucket'), { target: { value: 'other' } })
    fireEvent.click(button('Test'))

    expect((await screen.findByRole('status')).textContent).toContain('Wrong credentials')
    const [sent, secret] = vi.mocked(App.TestDestination).mock.calls[0]
    expect(sent.bucket).toBe('other')
    expect(secret).toBe('')
    expect(App.SaveDestination).not.toHaveBeenCalled()
  })

  it('asks before deleting', async () => {
    await open([dest()])
    fireEvent.click(button('Edit R2 snapshots'))
    fireEvent.click(button('Delete'))
    expect(App.DeleteDestination).not.toHaveBeenCalled()

    fireEvent.click(button('Keep'))
    expect(App.DeleteDestination).not.toHaveBeenCalled()

    fireEvent.click(button('Delete'))
    fireEvent.click(button('Confirm delete'))
    await waitFor(() => expect(App.DeleteDestination).toHaveBeenCalledWith('d1'))
  })

  it('does not offer delete on a destination that is not saved yet', async () => {
    await open([])
    fireEvent.click(button('Add destination'))
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })
})
