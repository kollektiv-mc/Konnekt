import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import { ConfigSummary } from './ConfigSummary'

vi.mock('../../../wailsjs/go/main/App')

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(cleanup)

const PROPS = [
  'motd=\\u00A7aSurvival \\u00A78\\u00B7 hi',
  'server-port=25565',
  'online-mode=true',
  'level-type=minecraft\\:normal',
  'rcon.password=hunter2',
].join('\n')

describe('ConfigSummary', () => {
  beforeEach(() => {
    vi.mocked(App.ReadConfigFile).mockResolvedValue(PROPS)
    vi.mocked(App.WriteConfigFile).mockResolvedValue(undefined)
  })

  it('draws the MOTD rather than its escapes', async () => {
    render(<ConfigSummary serverId="a" />)
    expect(await screen.findByTitle('Survival · hi')).toBeTruthy()
    expect(screen.queryByText(/u00A7/)).toBeNull()
  })

  it('shows values as the server reads them', async () => {
    render(<ConfigSummary serverId="a" />)
    expect(await screen.findByText('minecraft:normal')).toBeTruthy()
    expect(screen.getByText('25565')).toBeTruthy()
  })

  it('never puts the RCON password on screen', async () => {
    render(<ConfigSummary serverId="a" />)
    await screen.findByText('25565')
    expect(screen.queryByText('hunter2')).toBeNull()
  })

  it('still flips a switch with a click', async () => {
    render(<ConfigSummary serverId="a" />)
    fireEvent.click(await screen.findByText('On'))
    await waitFor(() =>
      expect(App.WriteConfigFile).toHaveBeenCalledWith(
        'a',
        'server.properties',
        expect.stringContaining('online-mode=false'),
      ),
    )
  })
})
