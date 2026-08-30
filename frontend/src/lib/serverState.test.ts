import { describe, it, expect } from 'vitest'
import { phaseFor, PHASE_DOT, PHASE_LABEL, type ServerPhase } from './serverState'

const status = (serverId: string, state: string) => ({ serverId, state })

describe('phaseFor', () => {
  it('reports the phase for the server that holds the process', () => {
    expect(phaseFor('alpha', status('alpha', 'running'), true)).toBe('running')
    expect(phaseFor('alpha', status('alpha', 'starting'), true)).toBe('starting')
    expect(phaseFor('alpha', status('alpha', 'stopping'), true)).toBe('stopping')
  })

  // The whole reason the id is on the status: one process, many rows.
  it('reports every other server as offline', () => {
    expect(phaseFor('beta', status('alpha', 'running'), true)).toBe('offline')
  })

  it('reports offline when nothing is running', () => {
    expect(phaseFor('alpha', status('', 'offline'), true)).toBe('offline')
  })

  // A dot claiming "running" for a backend nothing has heard from is the
  // failure `reachable` exists to prevent — the same argument as the tiles
  // that render "0 players" off a status they could not fetch.
  it('reports offline when the backend is unreachable, whatever it last said', () => {
    expect(phaseFor('alpha', status('alpha', 'running'), false)).toBe('offline')
  })

  it('treats a state it does not know as offline', () => {
    expect(phaseFor('alpha', status('alpha', 'wedged'), true)).toBe('offline')
    expect(phaseFor('alpha', status('alpha', ''), true)).toBe('offline')
  })

  it('never matches an unsaved row against a status with no server', () => {
    expect(phaseFor('', status('', 'running'), true)).toBe('offline')
  })
})

describe('phase tables', () => {
  const phases: ServerPhase[] = ['offline', 'starting', 'running', 'stopping']

  it('cover every phase', () => {
    for (const p of phases) {
      expect(PHASE_DOT[p]).toBeTruthy()
      expect(PHASE_LABEL[p]).toBeTruthy()
    }
  })

  // Selection is what the accent colour means in this list, and the row
  // background already carries it. A dot in the same colour made a stopped
  // server you had clicked look exactly like a running one.
  it('paints the dot from status tokens, never the skinnable accent', () => {
    for (const p of phases) expect(PHASE_DOT[p]).not.toContain('accent')
  })

  it('gives running and stopped different colours', () => {
    expect(PHASE_DOT.running).not.toBe(PHASE_DOT.offline)
  })
})
