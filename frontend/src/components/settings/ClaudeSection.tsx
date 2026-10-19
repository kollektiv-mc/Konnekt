import type { ConnectorsState, LocalMCPState, RemoteGrant } from '../../stores/useRemoteStore'
import { relativeMs } from '../../lib/format'
import { SettingRow } from '../ui/SettingRow'
import { Toggle } from '../ui/Toggle'
import { CopyButton } from './CopyButton'
import { DANGER_BUTTON, QUIET_BUTTON } from './controls'
import {
  claudeCodeHttpLine,
  claudeCodeStdioLine,
  claudeDesktopEntry,
  scopesLine,
} from './claudeSetup'

interface Props {
  local: LocalMCPState
  connectors: ConnectorsState
  /** True once the Remote Access password exists; a connector signs in with it. */
  passwordSet: boolean
  disabled: boolean
  onLocal: (on: boolean) => void
  onConnectors: (on: boolean) => void
  onRevoke: (id: string) => void
  onRevokeAll: () => void
}

const SECTION = 'border-border-subtle border-b-hairline py-3'

function lastUsed(grant: RemoteGrant): string {
  return grant.lastUsed ? `Last used ${relativeMs(grant.lastUsed)}` : 'Not used yet'
}

function SetupLine({ label, text }: { label: string; text: string }) {
  return (
    <div className="mt-2 flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-text-secondary text-xs">{label}</span>
        <span className="text-text-muted text-1xs truncate font-mono" title={text}>
          {text}
        </span>
      </div>
      <CopyButton text={text} />
    </div>
  )
}

/**
 * Claude's two ways into Konnekt's tools (#515), under Remote Access: the
 * bridge on this computer (#511), which is a second loopback listener, and
 * the connector endpoint on the tunnel (#513), which a client signs in to
 * with OAuth (#514). Both are off by default and decided here only. The
 * setup lines are copied rather than typed, since the executable's path is
 * the one thing a person gets wrong.
 */
export function ClaudeSection({
  local,
  connectors,
  passwordSet,
  disabled,
  onLocal,
  onConnectors,
  onRevoke,
  onRevokeAll,
}: Props) {
  const grants = connectors.grants ?? []
  // The endpoint needs an address a connector can keep, so the switch waits
  // for a named tunnel (§ S9.10), and for the password every sign-in asks for.
  const connectorsReady = connectors.url !== '' && passwordSet
  const connectorsNote = !passwordSet
    ? ' Set the password below first.'
    : connectors.url === ''
      ? ' Set up your own address under Tunnel first.'
      : ''

  return (
    <>
      <SettingRow
        label="Claude on this computer"
        description="Let Claude Code and Claude Desktop on this computer use Konnekt's tools. Nothing leaves the machine, and a command that could change the host still asks here."
      >
        <Toggle checked={local.enabled} disabled={disabled} onChange={onLocal} />
      </SettingRow>

      {local.enabled && (
        <div className={SECTION}>
          <p className="text-text-muted text-xs">
            {local.running
              ? `Listening on ${local.addr}. Register Konnekt once; Claude finds it again after a restart.`
              : 'Not listening. Switch it off and on again, or check konnekt.log.'}
          </p>
          <SetupLine label="Claude Code" text={claudeCodeStdioLine(local.executable)} />
          <SetupLine label="Claude Desktop config" text={claudeDesktopEntry(local.executable)} />
        </div>
      )}

      <SettingRow
        label="Claude connectors"
        description={`Let claude.ai, Claude Desktop and Claude Code reach Konnekt's tools through your own address. Each one signs in with the Remote Access password and your approval here, and the listener stays up for them.${connectorsNote}`}
      >
        <Toggle
          checked={connectors.enabled}
          disabled={disabled || (!connectors.enabled && !connectorsReady)}
          onChange={onConnectors}
        />
      </SettingRow>

      {connectors.enabled && (
        <div className={SECTION}>
          {connectors.url !== '' ? (
            <>
              <SetupLine
                label="Connector URL, for claude.ai and Claude Desktop"
                text={connectors.url}
              />
              <SetupLine label="Claude Code" text={claudeCodeHttpLine(connectors.url)} />
            </>
          ) : (
            <p className="text-text-muted text-xs">
              No address yet: set up your own address under Tunnel, and the connector URL appears
              here.
            </p>
          )}

          <div className="mt-3">
            <span className="text-text-secondary text-xs">Connected clients</span>
            {grants.length === 0 ? (
              <p className="text-text-muted text-1xs mt-0.5">
                None yet. Add the connector in Claude and sign in; it appears here once you approve
                it.
              </p>
            ) : (
              <>
                <ul className="mt-2 flex flex-col gap-2">
                  {grants.map((grant) => (
                    <li key={grant.id} className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-text-secondary truncate text-xs">
                          {grant.client}
                          {grant.redirect && (
                            <span className="text-text-faint"> via {grant.redirect}</span>
                          )}
                        </span>
                        <span className="text-text-muted text-1xs">{scopesLine(grant.scopes)}</span>
                        <span className="text-text-muted text-1xs">
                          Connected {relativeMs(grant.createdAt)}. {lastUsed(grant)}.
                        </span>
                      </div>
                      <button
                        disabled={disabled}
                        onClick={() => onRevoke(grant.id)}
                        className={DANGER_BUTTON}
                      >
                        Revoke
                      </button>
                    </li>
                  ))}
                </ul>
                {grants.length > 1 && (
                  <div className="mt-3 flex items-center gap-3">
                    <button disabled={disabled} onClick={onRevokeAll} className={QUIET_BUTTON}>
                      Revoke all
                    </button>
                    <span className="text-text-muted text-1xs">
                      Each one signs in again with the password and your approval.
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
