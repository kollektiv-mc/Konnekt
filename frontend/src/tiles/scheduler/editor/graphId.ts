/** How many characters of a graph's id the picker shows. */
export const SHORT_ID_LENGTH = 4

/** Stands in for the id of a graph that has none yet: unsaved, or no graph at all. */
export const NO_SHORT_ID = '····'

/**
 * The picker's short form of a graph id. Ids are a random 63-bit number in
 * hex (newID in backend/services/scheduler.go), so four characters tell the
 * graphs of one server apart for the eye without being a key for anything.
 */
export function shortGraphId(id: string | null): string {
  return id ? id.slice(0, SHORT_ID_LENGTH) : NO_SHORT_ID
}
