import { parse as parseToml } from 'smol-toml'
import { parseDocument } from 'yaml'

/**
 * Why `content` no longer parses as `format`, or null when it does (or the
 * format has no parser here). Shown above the raw editor, because a mod that
 * cannot parse its own config usually replaces it with defaults on its next
 * load, and "Raw only" alone did not say that anything was wrong.
 */
export function parseProblem(format: string, content: string): string | null {
  try {
    if (format === 'toml') {
      parseToml(content)
    } else if (format === 'json') {
      JSON.parse(content)
    } else if (format === 'yaml') {
      const err = parseDocument(content).errors[0]
      if (err) return firstLine(err.message)
    }
    return null
  } catch (err) {
    return describe(err)
  }
}

function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const message = firstLine(err.message)
  // smol-toml's TomlError carries the position; its message is a code frame.
  const line = (err as { line?: unknown }).line
  return typeof line === 'number' ? `line ${line}: ${message}` : message
}

function firstLine(s: string): string {
  return s.split('\n')[0].replace(/^Invalid TOML document: /, '')
}
