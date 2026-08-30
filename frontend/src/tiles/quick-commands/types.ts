/**
 * View-local shapes for the Commands tile.
 *
 * Anything that crosses the IPC boundary is aliased from the generated
 * bindings (see `stores/useCommandsStore.ts`), never redeclared here.
 */

/** Which rows the maximized library is showing. */
export type LibraryFilter = 'all' | 'linked' | 'attention'

/** A row being edited in place, before it is committed. */
export interface RowDraft {
  id: string
  label: string
  value: string
  group: string
}
