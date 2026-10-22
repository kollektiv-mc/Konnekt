import type { models } from '../../../../wailsjs/go/models'

export type BlockEntry =
  { kind: 'block'; def: models.BlockDef } | { kind: 'group'; name: string; defs: models.BlockDef[] }

/**
 * One category's blocks as the palette and the quick-add fly-out list them: a
 * block on its own, or a named group of blocks that share `BlockDef.group`.
 *
 * A group sits where its first member appeared and keeps the members' own
 * order, so the backend's registration order still decides the listing and an
 * ungrouped block never moves. `defs` is expected to be one category's blocks:
 * a group is scoped to its category, which is why `groupKey` carries it.
 */
export function blockEntries(defs: models.BlockDef[]): BlockEntry[] {
  const entries: BlockEntry[] = []
  const groups = new Map<string, Extract<BlockEntry, { kind: 'group' }>>()
  for (const def of defs) {
    if (!def.group) {
      entries.push({ kind: 'block', def })
      continue
    }
    const existing = groups.get(def.group)
    if (existing) {
      existing.defs.push(def)
      continue
    }
    const entry: Extract<BlockEntry, { kind: 'group' }> = {
      kind: 'group',
      name: def.group,
      defs: [def],
    }
    groups.set(def.group, entry)
    entries.push(entry)
  }
  return entries
}

/** The key a group's open state is stored under in `schedulerPaletteOpenGroups`. */
export const groupKey = (category: string, group: string): string => `${category}/${group}`
