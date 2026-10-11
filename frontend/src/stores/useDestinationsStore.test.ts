import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as App from '../../wailsjs/go/main/App'
import { useDestinationsStore } from './useDestinationsStore'
import type { Destination } from './useDestinationsStore'

vi.mock('../../wailsjs/go/main/App')

const dest = (over: Partial<Destination> = {}): Destination => ({
  id: 'd1',
  name: 'R2',
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'snapshots',
  prefix: '',
  publicBaseUrl: '',
  accessKeyId: 'AKID',
  secretSet: true,
  ...over,
})

describe('useDestinationsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDestinationsStore.setState({ destinations: [], loaded: false, loading: false, error: null })
    vi.mocked(App.ListDestinations).mockResolvedValue([dest()])
    vi.mocked(App.SaveDestination).mockResolvedValue(dest())
    vi.mocked(App.DeleteDestination).mockResolvedValue(undefined)
  })

  it('reads the list and marks itself loaded', async () => {
    await useDestinationsStore.getState().refresh()
    const s = useDestinationsStore.getState()
    expect(s.destinations).toEqual([dest()])
    expect(s.loaded).toBe(true)
    expect(s.loading).toBe(false)
  })

  it('records a failed read without throwing', async () => {
    vi.mocked(App.ListDestinations).mockRejectedValue('disk gone')
    await useDestinationsStore.getState().refresh()
    const s = useDestinationsStore.getState()
    expect(s.error).toBe('disk gone')
    expect(s.loaded).toBe(true)
    expect(s.loading).toBe(false)
  })

  it('passes the secret to the backend as its own argument and reads the list back', async () => {
    await useDestinationsStore.getState().save(dest({ secretSet: false }), 'hunter2')
    expect(App.SaveDestination).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd1' }),
      'hunter2',
    )
    expect(JSON.stringify(vi.mocked(App.SaveDestination).mock.calls[0][0])).not.toContain('hunter2')
    expect(App.ListDestinations).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(useDestinationsStore.getState())).not.toContain('hunter2')
  })

  it('records a refused save and rethrows it', async () => {
    vi.mocked(App.SaveDestination).mockRejectedValue(new Error('bucket is required'))
    await expect(useDestinationsStore.getState().save(dest(), '')).rejects.toThrow(
      'bucket is required',
    )
    expect(useDestinationsStore.getState().error).toBe('bucket is required')
    expect(App.ListDestinations).not.toHaveBeenCalled()
  })

  it('clears an old error when the next action starts', async () => {
    useDestinationsStore.setState({ error: 'old' })
    await useDestinationsStore.getState().remove('d1')
    expect(useDestinationsStore.getState().error).toBeNull()
    expect(App.DeleteDestination).toHaveBeenCalledWith('d1')
  })

  it('records a refused delete and rethrows it', async () => {
    vi.mocked(App.DeleteDestination).mockRejectedValue('locked')
    await expect(useDestinationsStore.getState().remove('d1')).rejects.toBe('locked')
    expect(useDestinationsStore.getState().error).toBe('locked')
  })

  it('returns the verdict of a test and leaves the list alone', async () => {
    const result = { ok: false, status: 'credentials', message: 'Wrong credentials' }
    vi.mocked(App.TestDestination).mockResolvedValue(result)
    await expect(useDestinationsStore.getState().test(dest(), '')).resolves.toEqual(result)
    expect(App.TestDestination).toHaveBeenCalledWith(dest(), '')
    expect(App.ListDestinations).not.toHaveBeenCalled()
  })

  it('records a test whose call was rejected', async () => {
    vi.mocked(App.TestDestination).mockRejectedValue(new Error('no bridge'))
    await expect(useDestinationsStore.getState().test(dest(), 's')).rejects.toThrow('no bridge')
    expect(useDestinationsStore.getState().error).toBe('no bridge')
  })
})
