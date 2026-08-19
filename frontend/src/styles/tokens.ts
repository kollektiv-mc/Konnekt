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

/**
 * Durations in milliseconds, for the JS half of a motion that CSS drives.
 *
 * A `setTimeout` that has to land with a transition cannot read `var(--duration-panel)`,
 * so before this existed the number was copied into the component and kept in step by
 * a comment. Read from here instead: an upstream change to the token then moves both
 * halves at once. Pure CSS should keep using the custom property.
 */
export const DURATION_MS = {
  fast: 150,
  panel: 280,
} as const
