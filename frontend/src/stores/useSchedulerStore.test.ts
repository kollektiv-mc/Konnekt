import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as App from '../../wailsjs/go/main/App'
import type { models } from '../../wailsjs/go/models'
import { useSchedulerStore } from './useSchedulerStore'
import { EVENTS } from '../lib/constants'

vi.mock('../../wailsjs/go/main/App')

function graph(id: string, enabled = true): models.Graph {
  return {
    id,
    name: id,
    enabled,
    nodes: [],
    edges: [],
    createdAt: 0,
    updatedAt: 0,
  } as unknown as models.Graph
}

const initial = {
  graphs: [],
  blockDefs: [],
  nextRuns: {},
  loading: false,
  hydrated: false,
  error: null,
}

describe('useSchedulerStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSchedulerStore.setState({ ...initial })
    vi.mocked(App.GetScheduleGraphs).mockResolvedValue([graph('g1')])
    vi.mocked(App.GetScheduleBlockDefs).mockResolvedValue([])
    vi.mocked(App.GetScheduleNextRuns).mockResolvedValue({ g1: 1000 })
  })

  describe('hydrate', () => {
    it('populates graphs, blockDefs and nextRuns', async () => {
      await useSchedulerStore.getState().hydrate()
      const s = useSchedulerStore.getState()
      expect(s.graphs).toEqual([graph('g1')])
      expect(s.nextRuns).toEqual({ g1: 1000 })
      expect(s.hydrated).toBe(true)
      expect(s.loading).toBe(false)
      expect(s.error).toBeNull()
    })

    it('never fetches run history', async () => {
      await useSchedulerStore.getState().hydrate()
      expect(App.GetScheduleRunHistory).not.toHaveBeenCalled()
    })

    it('no-ops once hydrated', async () => {
      await useSchedulerStore.getState().hydrate()
      await useSchedulerStore.getState().hydrate()
      expect(App.GetScheduleGraphs).toHaveBeenCalledTimes(1)
    })

    // Two tile instances (grid + maximized) mount in the same tick.
    it('dedupes concurrent calls', async () => {
      await Promise.all([
        useSchedulerStore.getState().hydrate(),
        useSchedulerStore.getState().hydrate(),
      ])
      expect(App.GetScheduleGraphs).toHaveBeenCalledTimes(1)
    })

    it('records the error, keeps last-good state, and stays un-hydrated', async () => {
      useSchedulerStore.setState({ graphs: [graph('cached')] })
      vi.mocked(App.GetScheduleGraphs).mockRejectedValue(new Error('no bridge'))

      await useSchedulerStore.getState().hydrate()

      const s = useSchedulerStore.getState()
      expect(s.error).toBe('no bridge')
      expect(s.graphs).toEqual([graph('cached')])
      expect(s.hydrated).toBe(false)
      expect(s.loading).toBe(false)
    })

    it('retries on a later call after a failure', async () => {
      vi.mocked(App.GetScheduleGraphs).mockRejectedValueOnce(new Error('no bridge'))
      await useSchedulerStore.getState().hydrate()
      await useSchedulerStore.getState().hydrate()
      expect(useSchedulerStore.getState().hydrated).toBe(true)
    })
  })

  describe('setNextRuns', () => {
    // The countdown text ("in 2h" → "in 1h") changes while the epoch does not,
    // and SchedulerSummary only re-renders on identity change — so a deep-equal
    // payload must still produce a new object.
    it('produces a new object identity even for a deep-equal payload', () => {
      useSchedulerStore.getState().setNextRuns({ g1: 1000 })
      const first = useSchedulerStore.getState().nextRuns
      useSchedulerStore.getState().setNextRuns({ g1: 1000 })
      const second = useSchedulerStore.getState().nextRuns

      expect(second).toEqual(first)
      expect(second).not.toBe(first)
    })

    it('treats a null payload as empty', () => {
      useSchedulerStore.getState().setNextRuns({ g1: 1000 })
      useSchedulerStore.getState().setNextRuns(null)
      expect(useSchedulerStore.getState().nextRuns).toEqual({})
    })
  })

  describe('saveGraph', () => {
    it('appends a new graph from the backend response', async () => {
      vi.mocked(App.SaveScheduleGraph).mockResolvedValue(graph('g2'))
      const saved = await useSchedulerStore.getState().saveGraph(graph(''))
      expect(saved.id).toBe('g2')
      expect(useSchedulerStore.getState().graphs).toEqual([graph('g2')])
      expect(App.GetScheduleGraphs).not.toHaveBeenCalled() // upsert, not refetch
    })

    it('replaces an existing graph in place', async () => {
      useSchedulerStore.setState({ graphs: [graph('g1'), graph('g2')] })
      const renamed = { ...graph('g1'), name: 'renamed' } as models.Graph
      vi.mocked(App.SaveScheduleGraph).mockResolvedValue(renamed)

      await useSchedulerStore.getState().saveGraph(renamed)

      const graphs = useSchedulerStore.getState().graphs
      expect(graphs).toHaveLength(2)
      expect(graphs[0].name).toBe('renamed')
    })

    it('records the error and rejects', async () => {
      useSchedulerStore.setState({ graphs: [graph('g1')] })
      vi.mocked(App.SaveScheduleGraph).mockRejectedValue('write failed')

      await expect(useSchedulerStore.getState().saveGraph(graph('g1'))).rejects.toBe('write failed')

      expect(useSchedulerStore.getState().error).toBe('write failed')
      expect(useSchedulerStore.getState().graphs).toEqual([graph('g1')])
    })
  })

  describe('deleteGraph', () => {
    it('drops the graph locally', async () => {
      useSchedulerStore.setState({ graphs: [graph('g1'), graph('g2')] })
      await useSchedulerStore.getState().deleteGraph('g1')
      expect(useSchedulerStore.getState().graphs).toEqual([graph('g2')])
      expect(App.DeleteScheduleGraph).toHaveBeenCalledWith('g1')
    })

    it('records the error, rejects, and keeps the graph', async () => {
      useSchedulerStore.setState({ graphs: [graph('g1')] })
      vi.mocked(App.DeleteScheduleGraph).mockRejectedValue(new Error('busy'))

      await expect(useSchedulerStore.getState().deleteGraph('g1')).rejects.toThrow('busy')

      expect(useSchedulerStore.getState().error).toBe('busy')
      expect(useSchedulerStore.getState().graphs).toEqual([graph('g1')])
    })
  })

  describe('setEnabled', () => {
    it('flips the flag locally', async () => {
      useSchedulerStore.setState({ graphs: [graph('g1', true)] })
      await useSchedulerStore.getState().setEnabled('g1', false)
      expect(useSchedulerStore.getState().graphs[0].enabled).toBe(false)
      expect(App.SetScheduleGraphEnabled).toHaveBeenCalledWith('g1', false)
    })

    it('records the error, rejects, and leaves the flag alone', async () => {
      useSchedulerStore.setState({ graphs: [graph('g1', true)] })
      vi.mocked(App.SetScheduleGraphEnabled).mockRejectedValue(new Error('offline'))

      await expect(useSchedulerStore.getState().setEnabled('g1', false)).rejects.toThrow('offline')

      expect(useSchedulerStore.getState().error).toBe('offline')
      expect(useSchedulerStore.getState().graphs[0].enabled).toBe(true)
    })
  })

  describe('runGraph', () => {
    it('returns the record without refetching history', async () => {
      const record = { id: 'r1', graphId: 'g1', status: 'success' } as unknown as models.RunRecord
      vi.mocked(App.RunScheduleGraphNow).mockResolvedValue(record)

      await expect(useSchedulerStore.getState().runGraph('g1')).resolves.toBe(record)
      expect(App.GetScheduleRunHistory).not.toHaveBeenCalled()
    })

    it('records the error and rejects', async () => {
      vi.mocked(App.RunScheduleGraphNow).mockRejectedValue(new Error('no trigger node'))
      await expect(useSchedulerStore.getState().runGraph('g1')).rejects.toThrow('no trigger node')
      expect(useSchedulerStore.getState().error).toBe('no trigger node')
    })
  })

  // NodeDataPanel surfaces preview failures next to the node it selected; they
  // must not raise a tile-wide banner.
  it('previewNode failures do not set the store error', async () => {
    vi.mocked(App.PreviewScheduleNode).mockRejectedValue(new Error('bad expression'))
    await expect(useSchedulerStore.getState().previewNode(graph('g1'), 'n1')).rejects.toThrow(
      'bad expression',
    )
    expect(useSchedulerStore.getState().error).toBeNull()
  })

  it('clearError resets the banner', () => {
    useSchedulerStore.setState({ error: 'boom' })
    useSchedulerStore.getState().clearError()
    expect(useSchedulerStore.getState().error).toBeNull()
  })

  // The Go constant and this mirror are hand-kept with no codegen, and a
  // mismatch fails silently (no push, no error). See scheduler_nextrun_test.go.
  it('mirrors the Go schedule:next-runs event name', () => {
    expect(EVENTS.SCHEDULE_NEXT_RUNS).toBe('schedule:next-runs')
  })
})
