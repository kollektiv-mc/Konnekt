export function fmtCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

// The GB tier is not decoration: a world save and a full-server backup zip are
// routinely gigabytes, and without it the Overview panel renders "4300.2 MB".
// The existing callers are all mod file sizes, which never reach it.
export function fmtBytes(b: number): string {
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB'
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

// Truncate from the front, keeping the tail. For a filesystem path the tail is
// the identifying part, so "…/servers/neoforge-1.21" beats "/home/alex/Doc…".
// Done in JS rather than with CSS `direction: rtl`, which reorders punctuation.
export function truncateStart(text: string, max: number): string {
  if (max <= 0) return ''
  if (text.length <= max) return text
  if (max === 1) return '…' // slice(-0) would return the whole string
  return '…' + text.slice(-(max - 1))
}

export function relativeTime(iso: string): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'today'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

/**
 * "12m ago" for a past epoch-ms timestamp.
 *
 * `relativeTime` above takes an ISO string, which is what the Modrinth API
 * returns. Everything Konnekt stores itself — a backup's `createdAt`, a world's
 * `modified` — is epoch ms, and three separate tiles had grown their own copy
 * of this before it was worth sharing.
 */
export function relativeMs(ms: number): string {
  // 0 is Go's zero value for an int64 epoch and means "never" (a world that
  // was never played, a player never seen), not 1 January 1970: without this
  // it renders as twenty thousand days ago. Every caller used to guard it
  // itself, or forgot to.
  if (!ms) return '—'
  const mins = Math.floor((Date.now() - ms) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

/**
 * "in 6h" for a future epoch-ms timestamp; "now" once it has passed.
 *
 * The forward-looking twin of `relativeMs`, for a scheduler next-run time.
 * Rounds rather than floors, so a run 59 minutes out reads "in 1h" instead of
 * "in 59m" — this is a countdown, and the coarse unit is the honest one.
 */
/**
 * "Sep 5, 2026, 06:30 PM" in the user's locale, for an epoch-ms timestamp.
 *
 * One `toLocaleString` call with both the date and the time options, so the
 * separator between them is the locale's own. The backups tile and the player
 * popup each had a copy, and the popup's joined `toLocaleDateString` and
 * `toLocaleTimeString` with a space by hand, so the two disagreed on every
 * backup card that also showed a last-seen time. The zero guard is the same
 * one `relativeMs` carries, for the same reason.
 */
export function fmtDate(ms: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function untilMs(ms: number): string {
  const diff = ms - Date.now()
  if (diff <= 0) return 'now'
  const mins = Math.round(diff / 60_000)
  if (mins < 60) return `in ${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `in ${hrs}h`
  return `in ${Math.round(hrs / 24)}d`
}
