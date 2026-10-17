import { describe, it, expect } from 'vitest'
import {
  claudeCodeHttpLine,
  claudeCodeStdioLine,
  claudeDesktopEntry,
  scopesLine,
  shellPath,
} from './claudeSetup'

describe('claudeSetup', () => {
  it('quotes a path only when a shell would need it', () => {
    expect(shellPath('/usr/local/bin/konnekt')).toBe('/usr/local/bin/konnekt')
    expect(shellPath('C:\\Program Files\\Konnekt\\konnekt.exe')).toBe(
      '"C:\\Program Files\\Konnekt\\konnekt.exe"',
    )
  })

  it('writes the stdio line with the executable and the mcp argument', () => {
    expect(claudeCodeStdioLine('C:\\Program Files\\Konnekt\\konnekt.exe')).toBe(
      'claude mcp add --transport stdio konnekt -- "C:\\Program Files\\Konnekt\\konnekt.exe" mcp',
    )
  })

  it('writes the Claude Desktop entry as the file takes it, path unquoted', () => {
    expect(JSON.parse(claudeDesktopEntry('C:\\Program Files\\Konnekt\\konnekt.exe'))).toEqual({
      mcpServers: {
        konnekt: { command: 'C:\\Program Files\\Konnekt\\konnekt.exe', args: ['mcp'] },
      },
    })
  })

  it('writes the http line with the connector URL', () => {
    expect(claudeCodeHttpLine('https://mc.example.com/mcp')).toBe(
      'claude mcp add --transport http konnekt https://mc.example.com/mcp',
    )
  })

  it('reads operate as the wider of the two scopes', () => {
    expect(scopesLine(['konnekt:read'])).toBe('Sees servers, players, console and schedules')
    expect(scopesLine(['konnekt:read', 'konnekt:operate'])).toBe('Sees and operates servers')
    expect(scopesLine(null)).toBe('Sees servers, players, console and schedules')
  })
})
