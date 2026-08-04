import { STATUS_DEFAULTS } from '../styles/tokens'

// The preset lists are product UI — which alternatives Settings offers — so they
// stay hand-authored. Only the first entry of each is a design decision, and it
// comes from the generated token defaults rather than being restated here; a
// second copy of #4ade80 is exactly the drift this pipeline exists to remove.
export const ACCENT_PRESETS = [
  { label: 'Green',  hex: STATUS_DEFAULTS.dark.accent },
  { label: 'Blue',   hex: '#3b82f6' },
  { label: 'Violet', hex: '#8b5cf6' },
  { label: 'Amber',  hex: '#f59e0b' },
  { label: 'Rose',   hex: '#f43f5e' },
  { label: 'Cyan',   hex: '#22d3ee' },
]

export const SUCCESS_PRESETS = [
  { label: 'Green',   hex: STATUS_DEFAULTS.dark.success },
  { label: 'Emerald', hex: '#10b981' },
  { label: 'Teal',    hex: '#14b8a6' },
  { label: 'Lime',    hex: '#84cc16' },
]

export const WARNING_PRESETS = [
  { label: 'Amber',  hex: STATUS_DEFAULTS.dark.warning },
  { label: 'Orange', hex: '#f97316' },
  { label: 'Yellow', hex: '#eab308' },
]

export const DANGER_PRESETS = [
  { label: 'Red',   hex: STATUS_DEFAULTS.dark.danger },
  { label: 'Rose',  hex: '#fb7185' },
  { label: 'Coral', hex: '#ef4444' },
]

export interface SkinDefinition {
  id: string
  name: string
  previewColors: [string, string, string, string]
  tokens: Record<string, string>
}

export const BUILTIN_SKINS: SkinDefinition[] = [
  {
    id: 'default',
    name: 'Default',
    previewColors: ['#05060a', '#0d0f16', '#1a1d26', '#4ade80'],
    tokens: {},
  },
  {
    id: 'midnight',
    name: 'Midnight',
    previewColors: ['#010408', '#070a12', '#0d1018', '#818cf8'],
    tokens: {
      '--bg-base':       '#010408',
      '--bg-surface':    'rgba(255,255,255,0.018)',
      '--border-subtle': 'rgba(255,255,255,0.045)',
      '--border-hover':  'rgba(255,255,255,0.09)',
      '--hover-surface': 'rgba(255,255,255,0.04)',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    previewColors: ['#2e3440', '#3b4252', '#4c566a', '#88c0d0'],
    tokens: {
      '--bg-base':        '#2e3440',
      '--bg-surface':     'rgba(255,255,255,0.04)',
      '--border-subtle':  'rgba(255,255,255,0.07)',
      '--border-hover':   'rgba(255,255,255,0.14)',
      '--text-primary':   '#eceff4',
      '--text-secondary': 'rgba(236,239,244,0.7)',
      '--text-muted':     'rgba(236,239,244,0.45)',
      '--text-faint':     'rgba(236,239,244,0.25)',
      '--hover-surface':  'rgba(255,255,255,0.06)',
    },
  },
  {
    id: 'solarized',
    name: 'Solarized',
    previewColors: ['#002b36', '#073642', '#586e75', '#268bd2'],
    tokens: {
      '--bg-base':        '#002b36',
      '--bg-surface':     'rgba(255,255,255,0.03)',
      '--border-subtle':  'rgba(255,255,255,0.07)',
      '--border-hover':   'rgba(255,255,255,0.14)',
      '--text-primary':   '#fdf6e3',
      '--text-secondary': 'rgba(253,246,227,0.65)',
      '--text-muted':     'rgba(253,246,227,0.45)',
      '--text-faint':     'rgba(253,246,227,0.28)',
      '--hover-surface':  'rgba(255,255,255,0.04)',
    },
  },
  {
    id: 'mocha',
    name: 'Mocha',
    previewColors: ['#1c1917', '#292524', '#44403c', '#fb923c'],
    tokens: {
      '--bg-base':        '#1c1917',
      '--bg-surface':     'rgba(255,255,255,0.025)',
      '--border-subtle':  'rgba(255,200,150,0.07)',
      '--border-hover':   'rgba(255,200,150,0.14)',
      '--text-primary':   '#faf7f0',
      '--text-secondary': 'rgba(250,247,240,0.65)',
      '--text-muted':     'rgba(250,247,240,0.42)',
      '--text-faint':     'rgba(250,247,240,0.25)',
      '--hover-surface':  'rgba(255,200,150,0.05)',
    },
  },
]

export interface SkinApplyArgs {
  theme: string
  accentColor: string
  skinId: string
  successColor: string
  warningColor: string
  dangerColor: string
  backgroundStyle: 'solid' | 'gradient'
}

function hexToRgbChannels(hex: string): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `${r} ${g} ${b}`
}

let prevSkinTokenKeys: string[] = []
let systemThemeCleanup: (() => void) | null = null

export function applySkin(args: SkinApplyArgs): void {
  systemThemeCleanup?.()
  systemThemeCleanup = null

  const root = document.documentElement

  // Clear previous skin token overrides
  for (const key of prevSkinTokenKeys) root.style.removeProperty(key)

  // Apply base mode
  if (args.theme === 'system') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => { root.dataset.theme = mq.matches ? 'dark' : 'light' }
    apply()
    mq.addEventListener('change', apply)
    systemThemeCleanup = () => mq.removeEventListener('change', apply)
  } else {
    root.dataset.theme = args.theme
  }

  // Apply skin token overrides
  const skin = BUILTIN_SKINS.find((s) => s.id === args.skinId) ?? BUILTIN_SKINS[0]
  const entries = Object.entries(skin.tokens)
  prevSkinTokenKeys = entries.map(([k]) => k)
  for (const [key, val] of entries) root.style.setProperty(key, val)

  // User overrides (always on top of skin).
  //
  // Only a *customised* colour is written. Writing all four unconditionally used to
  // defeat the light-theme values in tokens.css: an inline style on :root beats any
  // stylesheet rule, so [data-theme='light']'s darker success/warning/danger — the
  // ones that carry contrast against a light canvas — never applied.
  //
  // The comparison is against the dark defaults specifically because settings
  // persist one colour per role for both themes, seeded from that table (see
  // useSettingsStore). A stored value equal to it means "never touched", so
  // removing the property hands the choice back to the stylesheet, which is
  // theme-aware. That also makes theme: 'system' correct for free — flipping
  // appearance re-resolves through CSS with no JS involved.
  const overrides: Record<string, string> = {
    accent:  args.accentColor,
    success: args.successColor,
    warning: args.warningColor,
    danger:  args.dangerColor,
  }
  for (const [role, chosen] of Object.entries(overrides)) {
    if (chosen.toLowerCase() === STATUS_DEFAULTS.dark[role]) {
      root.style.removeProperty(`--${role}-rgb`)
    } else {
      root.style.setProperty(`--${role}-rgb`, hexToRgbChannels(chosen))
    }
  }

  root.style.setProperty(
    '--bg-gradient-overlay',
    args.backgroundStyle === 'gradient'
      ? 'radial-gradient(ellipse at top right, rgb(var(--accent-rgb) / 0.07) 0%, transparent 65%)'
      : 'none',
  )
}
