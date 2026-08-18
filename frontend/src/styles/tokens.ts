/* GENERATED FILE — DO NOT EDIT.
 *
 * Produced by frontend/scripts/gen-tokens.mjs from tokens.source.json, which is vendored
 * from kollektiv/design/tokens.json. Hand edits are reverted by the next run and
 * never reach Kommands, which derives its tokens from the same source.
 *
 * To change a value: edit kollektiv/design/tokens.json, run its
 * scripts/sync-tokens.sh, then `pnpm gen:tokens` from `frontend/`.
 */

export type ThemeMode = 'dark' | 'light'

/** Status roles the user can override at runtime from Settings. */
export const CONFIGURABLE_STATUS_ROLES = [
  'accent',
  'success',
  'warning',
  'danger',
] as const

export type ConfigurableStatusRole = (typeof CONFIGURABLE_STATUS_ROLES)[number]

/**
 * Per-theme defaults for the status colours.
 *
 * `dark` doubles as the *stored* default: persisted settings hold one colour per
 * role regardless of the active theme, and it is seeded from this table. That is
 * why applySkin() compares a user's colour against `dark` to decide whether it was
 * actually customised — see frontend/src/lib/theme.ts.
 */
export const STATUS_DEFAULTS: Record<ThemeMode, Record<string, string>> = {
  dark: {
  accent: '#4ade80',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#f87171',
  sun: '#ffd84d',
  },
  light: {
  accent: '#4ade80',
  success: '#16a34a',
  warning: '#d97706',
  danger: '#ef4444',
  sun: '#ffd84d',
  },
}
