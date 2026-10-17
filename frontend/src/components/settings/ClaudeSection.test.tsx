import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { ConnectorsState, LocalMCPState, RemoteGrant } from '../../stores/useRemoteStore'
import { ClaudeSection } from './ClaudeSection'

afterEach(cleanup)

const NOW = 1_700_000_000_000

const local = (over: Partial<LocalMCPState> = {}): LocalMCPState =>
  ({
    enabled: false,
    running: false,
    addr: '',
    command: '',
    executable: '/Applications/Konnekt.app/Contents/MacOS/konnekt',
    ...over,
  }) as LocalMCPState

const connectors = (over: Partial<ConnectorsState> = {}): ConnectorsState =>
  ({ enabled: false, url: '', grants: [], ...over }) as ConnectorsState

const grant = (over: Partial<RemoteGrant> = {}): RemoteGrant =>
  ({
    id: 'g1',
    client: 'Claude Code',
    redirect: 'localhost',
    scopes: ['konnekt:read'],
    createdAt: NOW - 3 * 86_400_000,
    lastUsed: NOW - 60_000,
    expiresAt: NOW + 3_600_000,
    ...over,
  }) as RemoteGrant

const handlers = {
  onLocal: vi.fn(),
  onConnectors: vi.fn(),
  onRevoke: vi.fn(),
  onRevokeAll: vi.fn(),
}

function draw(over: {
  local?: Partial<LocalMCPState>
  connectors?: Partial<ConnectorsState>
  passwordSet?: boolean
  disabled?: boolean
}) {
  return render(
    <ClaudeSection
      local={local(over.local)}
      connectors={connectors(over.connectors)}
      passwordSet={over.passwordSet ?? true}
      disabled={over.disabled ?? false}
      {...handlers}
    />,
  )
}

// Two switches: this computer first, the connectors after it.
const localToggle = () => screen.getAllByRole('switch')[0] as HTMLButtonElement
const connectorsToggle = () => screen.getAllByRole('switch')[1] as HTMLButtonElement

describe('ClaudeSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ now: NOW })
  })
  afterEach(() => vi.useRealTimers())

  describe('Claude on this computer', () => {
    it('switches on and off through the handler', () => {
      draw({})
      fireEvent.click(localToggle())
      expect(handlers.onLocal).toHaveBeenCalledWith(true)
      cleanup()
      draw({ local: { enabled: true, running: true, addr: '127.0.0.1:41234' } })
      fireEvent.click(localToggle())
      expect(handlers.onLocal).toHaveBeenLastCalledWith(false)
    })

    it('shows no setup while off', () => {
      draw({})
      expect(screen.queryByText('Claude Code')).toBeNull()
      expect(screen.queryByText(/Listening on/)).toBeNull()
    })

    it('shows the address and both setup lines while on', () => {
      draw({ local: { enabled: true, running: true, addr: '127.0.0.1:41234' } })
      expect(screen.getByText(/Listening on 127\.0\.0\.1:41234/)).toBeTruthy()
      expect(
        screen.getByText(
          'claude mcp add --transport stdio konnekt -- /Applications/Konnekt.app/Contents/MacOS/konnekt mcp',
        ),
      ).toBeTruthy()
      const entry = screen.getByText(/"mcpServers"/).textContent ?? ''
      expect(JSON.parse(entry)).toEqual({
        mcpServers: {
          konnekt: { command: '/Applications/Konnekt.app/Contents/MacOS/konnekt', args: ['mcp'] },
        },
      })
    })

    it('says so when the switch is on but nothing listens', () => {
      draw({ local: { enabled: true, running: false } })
      expect(screen.getByText(/Not listening/)).toBeTruthy()
    })

    it('is disabled while an action runs', () => {
      draw({ disabled: true })
      expect(localToggle().disabled).toBe(true)
      expect(connectorsToggle().disabled).toBe(true)
    })
  })

  describe('Claude connectors', () => {
    it('waits for a password', () => {
      draw({ passwordSet: false, connectors: { url: 'https://mc.example.com/mcp' } })
      expect(connectorsToggle().disabled).toBe(true)
      expect(screen.getByText(/Set the password below first\./)).toBeTruthy()
    })

    it('waits for a named tunnel', () => {
      draw({})
      expect(connectorsToggle().disabled).toBe(true)
      expect(screen.getByText(/Set up your own address under Tunnel first\./)).toBeTruthy()
    })

    it('switches on with an address and a password, and off regardless', () => {
      draw({ connectors: { url: 'https://mc.example.com/mcp' } })
      expect(connectorsToggle().disabled).toBe(false)
      fireEvent.click(connectorsToggle())
      expect(handlers.onConnectors).toHaveBeenCalledWith(true)
      cleanup()
      // The address went (the named tunnel was forgotten): the switch still turns off.
      draw({ connectors: { enabled: true, url: '' } })
      expect(connectorsToggle().disabled).toBe(false)
      fireEvent.click(connectorsToggle())
      expect(handlers.onConnectors).toHaveBeenLastCalledWith(false)
      expect(screen.getByText(/No address yet/)).toBeTruthy()
    })

    it('shows the connector URL and the Claude Code line while on', () => {
      draw({ connectors: { enabled: true, url: 'https://mc.example.com/mcp' } })
      expect(screen.getByText('https://mc.example.com/mcp')).toBeTruthy()
      expect(
        screen.getByText('claude mcp add --transport http konnekt https://mc.example.com/mcp'),
      ).toBeTruthy()
      expect(screen.getByText(/None yet/)).toBeTruthy()
    })

    it('lists each client with its redirect host, scopes and times', () => {
      draw({
        connectors: {
          enabled: true,
          url: 'https://mc.example.com/mcp',
          grants: [
            grant(),
            grant({
              id: 'g2',
              client: 'Claude',
              redirect: 'claude.ai',
              scopes: ['konnekt:operate', 'konnekt:read'],
              lastUsed: 0,
            }),
          ],
        },
      })
      // "Claude Code" is also the setup line's label, so match the whole row's text.
      const rows = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
      expect(rows[0]).toContain('Claude Code via localhost')
      expect(rows[1]).toContain('Claude via claude.ai')
      expect(screen.getByText('Sees servers, players, console and schedules')).toBeTruthy()
      expect(screen.getByText('Sees and operates servers')).toBeTruthy()
      expect(screen.getByText(/Connected 3d ago\. Last used 1m ago\./)).toBeTruthy()
      expect(screen.getByText(/Not used yet\./)).toBeTruthy()
    })

    it('revokes one client by its id, and all of them', () => {
      draw({
        connectors: {
          enabled: true,
          url: 'https://mc.example.com/mcp',
          grants: [grant(), grant({ id: 'g2', client: 'Claude' })],
        },
      })
      fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[1])
      expect(handlers.onRevoke).toHaveBeenCalledWith('g2')
      fireEvent.click(screen.getByRole('button', { name: 'Revoke all' }))
      expect(handlers.onRevokeAll).toHaveBeenCalledTimes(1)
    })

    it('offers Revoke all only with more than one client', () => {
      draw({ connectors: { enabled: true, url: 'https://mc.example.com/mcp', grants: [grant()] } })
      expect(screen.queryByRole('button', { name: 'Revoke all' })).toBeNull()
    })
  })

  it('uses no em dash in what it shows', () => {
    const { container } = draw({
      local: { enabled: true, running: true, addr: '127.0.0.1:1' },
      connectors: { enabled: true, url: 'https://mc.example.com/mcp', grants: [grant()] },
    })
    expect(container.textContent).not.toContain('—')
  })
})
