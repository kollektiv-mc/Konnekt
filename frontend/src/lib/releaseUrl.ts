/**
 * The updater's links come from the GitHub API, so they reach the OS URL
 * handler from the network. Wails only denylists a few schemes, so an
 * allowlist is checked here: this repository's own pages over https, and
 * nothing else (#437).
 *
 * The check runs on the parsed URL, never on the raw string: `new URL`
 * resolves `..` segments, lowercases the host and splits off any `user@`
 * prefix, which is what defeats `https://github.com@evil.example/` and
 * `https://github.com.evil.example/` look-alikes a string prefix would accept.
 */
const RELEASE_HOST = 'github.com'
const RELEASE_PATH_PREFIX = '/kollektiv-mc/Konnekt/'

/** The normalized URL when it is one of this repository's https pages, else null. */
export function releaseUrlToOpen(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.hostname !== RELEASE_HOST || url.port !== '') return null
  if (url.username !== '' || url.password !== '') return null
  if (!url.pathname.startsWith(RELEASE_PATH_PREFIX)) return null
  return url.href
}
