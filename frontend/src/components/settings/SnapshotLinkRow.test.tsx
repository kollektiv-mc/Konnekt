import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import { useDestinationsStore } from '../../stores/useDestinationsStore'
import type { Destination, SnapshotLinkResult } from '../../stores/useDestinationsStore'
import { DestinationsPane } from './DestinationsPane'
import { SnapshotLinkRow } from './SnapshotLinkRow'

vi.mock('../../../wailsjs/go/main/App')

afterEach(cleanup)

const LINK = 'https://files.example.com/dh/mfrggzdfmztwq2lknnwg23tpobyxe43u/latest.json'
const TOKEN = 'mfrggzdfmztwq2lknnwg23tpob'

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

const result = (over: Partial<SnapshotLinkResult> = {}): SnapshotLinkResult => ({
  private: false,
  link: '',
  message: '',
  oldLinkStillWorks: false,
  ...over,
})

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement
const queryButton = (name: string | RegExp) => screen.queryByRole('button', { name })
const modeSwitch = () => screen.getByRole('switch') as HTMLButtonElement

describe('SnapshotLinkRow', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    writeText = vi.fn(() => Promise.resolve())
    Object.assign(navigator, { clipboard: { writeText } })
    useDestinationsStore.setState({ destinations: [], loaded: false, loading: false, error: null })
    vi.mocked(App.ListDestinations).mockResolvedValue([dest()])
  })

  it('shows a public destination as public, with Copy link and no Rotate', () => {
    render(<SnapshotLinkRow destination={dest()} />)
    expect(modeSwitch().getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('Public')).toBeTruthy()
    expect(button('Copy link')).toBeTruthy()
    expect(queryButton(/Rotate link/)).toBeNull()
  })

  it('shows a private destination as private, with Rotate link', () => {
    render(<SnapshotLinkRow destination={dest({ privateLink: true })} />)
    expect(modeSwitch().getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Private link')).toBeTruthy()
    expect(button('Rotate link for R2 snapshots')).toBeTruthy()
  })

  it('carries no explanatory copy beside the mode and the copy button', () => {
    render(<SnapshotLinkRow destination={dest()} />)
    expect(screen.getByText('Snapshot link')).toBeTruthy()
    expect(screen.queryByText(/shared secret/)).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('fetches the link only when Copy link is clicked, and copies it', async () => {
    vi.mocked(App.GetSnapshotLink).mockResolvedValue(result({ link: LINK, private: true }))
    render(<SnapshotLinkRow destination={dest({ privateLink: true })} />)
    expect(App.GetSnapshotLink).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain(TOKEN)

    await act(async () => {
      fireEvent.click(button('Copy link'))
    })
    expect(App.GetSnapshotLink).toHaveBeenCalledWith('d1')
    expect(writeText).toHaveBeenCalledWith(LINK)
    expect(button('Copied')).toBeTruthy()
    // It reached the clipboard and nowhere else.
    expect(document.body.textContent).not.toContain(TOKEN)
    expect(JSON.stringify(useDestinationsStore.getState())).not.toContain(TOKEN)
  })

  it('shows the backend message when Copy link is refused, and copies nothing', async () => {
    vi.mocked(App.GetSnapshotLink).mockRejectedValue(
      new Error('nothing has been published to this destination yet'),
    )
    render(<SnapshotLinkRow destination={dest()} />)
    await act(async () => {
      fireEvent.click(button('Copy link'))
    })
    expect((await screen.findByRole('status')).textContent).toContain('nothing has been published')
    expect(writeText).not.toHaveBeenCalled()
    expect(button('Copy link')).toBeTruthy()
  })

  it('says so when the clipboard refuses the link', async () => {
    vi.mocked(App.GetSnapshotLink).mockResolvedValue(result({ link: LINK }))
    writeText.mockImplementation(() => Promise.reject(new Error('denied')))
    render(<SnapshotLinkRow destination={dest()} />)
    await act(async () => {
      fireEvent.click(button('Copy link'))
    })
    expect((await screen.findByRole('status')).textContent).toContain('clipboard refused')
    expect(document.body.textContent).not.toContain(LINK)
  })

  it('asks before switching the mode, and does nothing on Keep', async () => {
    render(<SnapshotLinkRow destination={dest()} />)
    fireEvent.click(modeSwitch())
    expect(App.SetSnapshotLinkPrivate).not.toHaveBeenCalled()
    expect(screen.getByText(/address everyone uses now stops working/)).toBeTruthy()

    fireEvent.click(button('Keep'))
    expect(App.SetSnapshotLinkPrivate).not.toHaveBeenCalled()
    expect(queryButton('Confirm switch')).toBeNull()
  })

  it('switches to private after the confirm, then reads the list back', async () => {
    vi.mocked(App.SetSnapshotLinkPrivate).mockResolvedValue(
      result({ private: true, message: 'The snapshot is now under a private link.' }),
    )
    render(<SnapshotLinkRow destination={dest()} />)
    fireEvent.click(modeSwitch())
    fireEvent.click(button('Confirm switch'))

    await waitFor(() => expect(App.SetSnapshotLinkPrivate).toHaveBeenCalledWith('d1', true))
    expect((await screen.findByRole('status')).textContent).toContain('now under a private link')
    expect(App.ListDestinations).toHaveBeenCalled()
    expect(queryButton('Confirm switch')).toBeNull()
  })

  it('switches back to public with the private link stopped, after the confirm', async () => {
    vi.mocked(App.SetSnapshotLinkPrivate).mockResolvedValue(result({ message: 'Public again.' }))
    render(<SnapshotLinkRow destination={dest({ privateLink: true })} />)
    fireEvent.click(modeSwitch())
    expect(screen.getByText(/private link stops working/)).toBeTruthy()
    fireEvent.click(button('Confirm switch'))
    await waitFor(() => expect(App.SetSnapshotLinkPrivate).toHaveBeenCalledWith('d1', false))
  })

  it('asks before rotating, saying everyone loses access', async () => {
    vi.mocked(App.RotateSnapshotLink).mockResolvedValue(
      result({ private: true, message: 'The link was rotated.' }),
    )
    render(<SnapshotLinkRow destination={dest({ privateLink: true })} />)
    fireEvent.click(button('Rotate link for R2 snapshots'))
    expect(App.RotateSnapshotLink).not.toHaveBeenCalled()
    expect(screen.getByText(/Everyone with the current link loses access/)).toBeTruthy()

    fireEvent.click(button('Keep'))
    expect(App.RotateSnapshotLink).not.toHaveBeenCalled()

    fireEvent.click(button('Rotate link for R2 snapshots'))
    fireEvent.click(button('Confirm rotate'))
    await waitFor(() => expect(App.RotateSnapshotLink).toHaveBeenCalledWith('d1'))
    expect((await screen.findByRole('status')).textContent).toContain('rotated')
  })

  it('disables the controls and says so while a move runs', async () => {
    let finish: (r: SnapshotLinkResult) => void = () => {}
    vi.mocked(App.RotateSnapshotLink).mockReturnValue(new Promise((r) => (finish = r)))
    render(<SnapshotLinkRow destination={dest({ privateLink: true })} />)
    fireEvent.click(button('Rotate link for R2 snapshots'))
    fireEvent.click(button('Confirm rotate'))

    expect((await screen.findByRole('status')).textContent).toContain('few minutes')
    expect(modeSwitch().disabled).toBe(true)
    expect(button('Rotate link for R2 snapshots').disabled).toBe(true)
    await act(async () => finish(result({ private: true, message: 'The link was rotated.' })))
    expect(modeSwitch().disabled).toBe(false)
  })

  it('shows a refusal of a move, and a link that could not be retired, as a problem', async () => {
    vi.mocked(App.SetSnapshotLinkPrivate).mockRejectedValue(
      new Error('The snapshot could not be moved, so the link is unchanged: boom'),
    )
    render(<SnapshotLinkRow destination={dest()} />)
    fireEvent.click(modeSwitch())
    fireEvent.click(button('Confirm switch'))
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('link is unchanged'),
    )
    expect(screen.getByRole('status').className).toContain('text-danger')

    vi.mocked(App.SetSnapshotLinkPrivate).mockResolvedValue(
      result({
        private: true,
        message: 'Moved. The old one may still work.',
        oldLinkStillWorks: true,
      }),
    )
    fireEvent.click(modeSwitch())
    fireEvent.click(button('Confirm switch'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('may still work'))
    expect(screen.getByRole('status').className).toContain('text-danger')
  })
})

describe('DestinationsPane with the snapshot link', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDestinationsStore.setState({ destinations: [], loaded: false, loading: false, error: null })
  })

  it('puts a Snapshot link row on each saved destination, and none on a new one', async () => {
    vi.mocked(App.ListDestinations).mockResolvedValue([
      dest(),
      dest({ id: 'd2', name: 'Backup', privateLink: true }),
    ])
    render(<DestinationsPane />)
    await screen.findByText('R2 snapshots')
    expect(screen.getAllByText('Snapshot link')).toHaveLength(2)
    expect(screen.getAllByRole('switch')).toHaveLength(2)

    fireEvent.click(button('Add destination'))
    expect(screen.getAllByText('Snapshot link')).toHaveLength(2)
  })

  it('shows the refusal in the pane banner as well as beside the button', async () => {
    vi.mocked(App.ListDestinations).mockResolvedValue([dest()])
    vi.mocked(App.GetSnapshotLink).mockRejectedValue(new Error('nothing has been published yet'))
    Object.assign(navigator, { clipboard: { writeText: vi.fn() } })
    render(<DestinationsPane />)
    await screen.findByText('R2 snapshots')
    await act(async () => {
      fireEvent.click(button('Copy link'))
    })
    expect((await screen.findByRole('alert')).textContent).toContain('nothing has been published')
  })
})
