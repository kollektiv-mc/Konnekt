/**
 * Pure helpers for the server editor.
 *
 * They live here rather than beside the component so they can be tested
 * without rendering, and so the component file exports components only.
 */

/** Reads -Xms/-Xmx out of a JVM argument expression. Missing flags give "". */
export function parseRamFromArgs(args: string): { minRam: string; maxRam: string } {
  return {
    minRam: args.match(/-Xms(\S+)/)?.[1] ?? '',
    maxRam: args.match(/-Xmx(\S+)/)?.[1] ?? '',
  }
}

/**
 * Writes minRam/maxRam back into a JVM argument expression, replacing the
 * flags in place when present and appending them when not, so the rest of a
 * hand-written expression survives a trip through the simple RAM fields.
 * An empty value leaves that flag alone rather than deleting it.
 */
export function mergeRamIntoArgs(args: string, minRam: string, maxRam: string): string {
  let result = args
  if (minRam) {
    result = /-Xms\S+/.test(result)
      ? result.replace(/-Xms\S+/, `-Xms${minRam}`)
      : `${result} -Xms${minRam}`.trim()
  }
  if (maxRam) {
    result = /-Xmx\S+/.test(result)
      ? result.replace(/-Xmx\S+/, `-Xmx${maxRam}`)
      : `${result} -Xmx${maxRam}`.trim()
  }
  return result
}

/**
 * The directory part of a path, handling both separators because the path
 * comes from a native file dialog on whichever OS the user is running.
 */
export function dirOf(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return idx >= 0 ? filePath.substring(0, idx) : ''
}

/** The last path segment, ignoring trailing separators. */
export function baseOf(filePath: string): string {
  const trimmed = filePath.replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx >= 0 ? trimmed.substring(idx + 1) : trimmed
}

/**
 * Whether a picked path is an installer-generated launcher rather than a jar.
 * Picking one only tells Konnekt where the install is: the backend resolves
 * the launch from the directory, so the jar path is left empty.
 */
export function isLaunchScript(filePath: string): boolean {
  return /[\\/]run\.(sh|bat|cmd)$/i.test(filePath) || /^run\.(sh|bat|cmd)$/i.test(filePath)
}
