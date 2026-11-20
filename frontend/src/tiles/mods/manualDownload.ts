import { BrowserOpenURL } from '../../../wailsjs/runtime/runtime'

// A CurseForge author can turn off downloads in other apps. Konnekt then shows
// the mod but never fetches its files, and this is the install it offers: the
// file's page, opened in the system browser. Only https reaches the browser.
export function openPage(url: string) {
  if (!/^https:\/\//i.test(url)) return
  try {
    BrowserOpenURL(url)
  } catch {
    /* non-Wails context (e.g. pnpm dev preview) */
  }
}

export const MANUAL_DOWNLOAD_REASON = 'Its author allows downloads on CurseForge only.'
