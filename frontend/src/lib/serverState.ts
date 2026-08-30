import type { ServerStatus } from '../types'

/**
 * The lifecycle phases `backend/services/server.go` moves a server through
 * (#108), as the sidebar reads them.
 */
export type ServerPhase = 'offline' | 'starting' | 'running' | 'stopping'

const PHASES: readonly string[] = ['offline', 'starting', 'running', 'stopping']

/**
 * Which phase one *configured* server is in, given the app-wide status.
 *
 * `status` describes the single process this build can have, so it answers for
 * exactly one server at a time — the one named by `status.serverId`. Every
 * other configured server is offline by definition, and that is the whole point
 * of the id being on the status at all: without it a list of servers can only
 * show "something is running somewhere".
 *
 * An unreachable backend reports offline rather than the last phase it saw. A
 * dot claiming `running` for a server nothing has heard from since is the
 * failure `useServerStore`'s `reachable` exists to prevent.
 */
export function phaseFor(
  serverId: string,
  status: Pick<ServerStatus, 'serverId' | 'state'>,
  reachable: boolean,
): ServerPhase {
  if (!reachable || !serverId || status.serverId !== serverId) return 'offline'
  return PHASES.includes(status.state) ? (status.state as ServerPhase) : 'offline'
}

/**
 * The status dot's colour per phase, as token-backed utilities.
 *
 * Semantic tokens rather than `--accent`: the accent is the user's skin colour
 * and can be any hue, so a dot painted with it says "this row is themed", not
 * "this server is up". Selection is what the accent means in this list, and it
 * is already carried by the row's background.
 */
export const PHASE_DOT: Record<ServerPhase, string> = {
  offline: 'bg-text-faint',
  starting: 'bg-warning animate-pulse',
  running: 'bg-success',
  stopping: 'bg-danger animate-pulse',
}

/** Spoken form, for the dot's title. */
export const PHASE_LABEL: Record<ServerPhase, string> = {
  offline: 'Stopped',
  starting: 'Starting',
  running: 'Running',
  stopping: 'Stopping',
}
