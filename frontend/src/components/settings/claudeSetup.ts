/**
 * The lines Settings offers to copy for Claude's two ways into Konnekt (#515),
 * and the words for a grant's scopes. Pure, so ClaudeSection stays a
 * component file.
 */

/** A path as a shell takes it: quoted when it has a space, which Windows paths do. */
export function shellPath(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path
}

/** The `claude mcp add` line for the bridge on this computer. */
export function claudeCodeStdioLine(executable: string): string {
  return `claude mcp add --transport stdio konnekt -- ${shellPath(executable)} mcp`
}

/** The entry for Claude Desktop's config file. */
export function claudeDesktopEntry(executable: string): string {
  return JSON.stringify(
    { mcpServers: { konnekt: { command: executable, args: ['mcp'] } } },
    null,
    2,
  )
}

/** The `claude mcp add` line for the endpoint through the tunnel. */
export function claudeCodeHttpLine(url: string): string {
  return `claude mcp add --transport http konnekt ${url}`
}

/** What a grant's scopes let the client do, in the consent page's words. */
export function scopesLine(scopes: string[] | null | undefined): string {
  return (scopes ?? []).includes('konnekt:operate')
    ? 'Sees and operates servers'
    : 'Sees servers, players, console and schedules'
}
