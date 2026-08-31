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
export function untilMs(ms: number): string {
  const diff = ms - Date.now()
  if (diff <= 0) return 'now'
  const mins = Math.round(diff / 60_000)
  if (mins < 60) return `in ${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `in ${hrs}h`
  return `in ${Math.round(hrs / 24)}d`
}
