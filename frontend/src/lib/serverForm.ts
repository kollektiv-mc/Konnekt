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

const MB_PER_UNIT: Record<string, number> = { k: 1 / 1024, m: 1, g: 1024, t: 1024 * 1024 }

/**
 * A JVM size (`2G`, `512m`, `1536M`) in megabytes, or null when it is not one.
 * A bare number is bytes, as the JVM reads it. Anything the JVM would refuse,
 * including an empty field, gives null so no warning is built on a guess.
 */
export function heapToMB(value: string): number | null {
  const m = /^(\d+)([kmgt])?$/i.exec(value.trim())
  if (!m) return null
  const n = Number(m[1])
  return m[2] ? n * MB_PER_UNIT[m[2].toLowerCase()] : n / (1024 * 1024)
}

/**
 * Where an allocation starts to worry us, as a share of physical RAM. A JVM
 * resident-sets more than its heap (metaspace, threads, native buffers, roughly
 * 5 to 15 percent), so by 85% the OS has little left for itself and by 95% the
 * process is likely to thrash or be killed. Advisory only: nothing is refused.
 */
export const HEAP_WARN_RATIO = 0.85
export const HEAP_STRONG_RATIO = 0.95

export type HeapAdvice = { level: 'warning' | 'strong'; message: string }

/** `512 MB`, `14 GB`, `15.5 GB`: whole megabytes below a gigabyte, else one decimal at most. */
export function formatMB(mb: number): string {
  if (mb < 1024) return `${Math.round(mb)} MB`
  return `${Number((mb / 1024).toFixed(1))} GB`
}

/**
 * The warning for a max-heap value against the machine's RAM, or null when
 * there is nothing to say: an unreadable size, an unknown total, or a heap
 * under the threshold. The message carries both numbers.
 */
export function heapAdvice(maxRam: string, totalMB: number | null): HeapAdvice | null {
  const heapMB = heapToMB(maxRam)
  if (heapMB === null || totalMB === null || totalMB <= 0) return null
  const ratio = heapMB / totalMB
  if (ratio < HEAP_WARN_RATIO) return null
  const share = `${formatMB(heapMB)} max heap is ${Math.round(ratio * 100)}% of this machine's ${formatMB(totalMB)} of RAM.`
  return ratio >= HEAP_STRONG_RATIO
    ? { level: 'strong', message: `${share} The server will likely thrash or be killed.` }
    : { level: 'warning', message: `${share} The JVM uses more than its heap, so leave room.` }
}
