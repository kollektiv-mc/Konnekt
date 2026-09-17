/**
 * The pure half of `components/ui/Combobox`: option matching, with no React in
 * it. Kept here so the list behaviour can be tested directly, the way the rest
 * of `lib/` is.
 */

export interface ComboboxOption {
  value: string
  label: string
}

/**
 * Options whose label or value contains `query`, case-insensitively.
 *
 * Substring rather than prefix: preset lists here read as dotted paths
 * (`server.motd`, `players.count`), so typing the half anyone remembers is the
 * tail, not the head.
 */
export function filterOptions(options: ComboboxOption[], query: string): ComboboxOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return options
  return options.filter(
    (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
  )
}

/**
 * The index a `<select>`-style typeahead would land on: the first option whose
 * label starts with `buffer`, searching forward from `from` and wrapping.
 * Returns -1 when nothing matches, which the caller reads as "leave the
 * highlight alone" rather than "select nothing".
 */
export function typeaheadIndex(
  options: ComboboxOption[],
  buffer: string,
  from: number = 0,
): number {
  const b = buffer.trim().toLowerCase()
  if (!b || options.length === 0) return -1
  for (let i = 0; i < options.length; i++) {
    const idx = (from + i) % options.length
    if (options[idx].label.toLowerCase().startsWith(b)) return idx
  }
  return -1
}
