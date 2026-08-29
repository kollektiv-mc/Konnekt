import { STATUS_DEFAULTS } from '../styles/tokens'

// The preset lists are product UI — which alternatives Settings offers — so they
// stay hand-authored. Only the first entry of each is a design decision, and it
// comes from the generated token defaults rather than being restated here; a
// second copy of #4ade80 is exactly the drift this pipeline exists to remove.
export const ACCENT_PRESETS = [
  { label: 'Green', hex: STATUS_DEFAULTS.dark.accent },
  { label: 'Blue', hex: '#3b82f6' },
  { label: 'Violet', hex: '#8b5cf6' },
  { label: 'Amber', hex: '#f59e0b' },
  { label: 'Rose', hex: '#f43f5e' },
  { label: 'Cyan', hex: '#22d3ee' },
]

export const SUCCESS_PRESETS = [
  { label: 'Green', hex: STATUS_DEFAULTS.dark.success },
  { label: 'Emerald', hex: '#10b981' },
  { label: 'Teal', hex: '#14b8a6' },
  { label: 'Lime', hex: '#84cc16' },
]

export const WARNING_PRESETS = [
  { label: 'Amber', hex: STATUS_DEFAULTS.dark.warning },
  { label: 'Orange', hex: '#f97316' },
  { label: 'Yellow', hex: '#eab308' },
]

export const DANGER_PRESETS = [
  { label: 'Red', hex: STATUS_DEFAULTS.dark.danger },
  { label: 'Rose', hex: '#fb7185' },
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
      '--bg-base': '#010408',
      '--bg-elevated': 'rgba(14,17,26,0.82)',
      '--bg-overlay': '#0b0e16',
      '--bg-surface': 'rgba(255,255,255,0.018)',
      '--border-subtle': 'rgba(255,255,255,0.045)',
      '--border-hover': 'rgba(255,255,255,0.09)',
      '--hover-surface': 'rgba(255,255,255,0.04)',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    previewColors: ['#2e3440', '#3b4252', '#4c566a', '#88c0d0'],
    tokens: {
      '--bg-base': '#2e3440',
      '--bg-elevated': 'rgba(59,66,82,0.82)',
      '--bg-overlay': '#3b4252',
      '--bg-surface': 'rgba(255,255,255,0.04)',
      '--border-subtle': 'rgba(255,255,255,0.07)',
      '--border-hover': 'rgba(255,255,255,0.14)',
      '--text-primary': '#eceff4',
      '--text-secondary': 'rgba(236,239,244,0.7)',
      '--text-muted': 'rgba(236,239,244,0.45)',
      '--text-faint': 'rgba(236,239,244,0.25)',
      '--hover-surface': 'rgba(255,255,255,0.06)',
    },
  },
  {
    id: 'solarized',
    name: 'Solarized',
    previewColors: ['#2b0d10', '#3d1519', '#75585c', '#dc322f'],
    tokens: {
      '--bg-base': '#2b0d10',
      '--bg-elevated': 'rgba(58,24,28,0.82)',
      '--bg-overlay': '#37171b',
      // Neutral white, deliberately: the warmth comes from the borders and the
      // text ramp. Tinting the surface too made every tile read as a second hue
      // sitting on the canvas rather than a lift out of it.
      '--bg-surface': 'rgba(255,255,255,0.03)',
      '--border-subtle': 'rgba(255,210,200,0.08)',
      '--border-hover': 'rgba(255,210,200,0.16)',
      '--text-primary': '#fdf6e3',
      '--text-secondary': 'rgba(253,246,227,0.65)',
      '--text-muted': 'rgba(253,246,227,0.45)',
      '--text-faint': 'rgba(253,246,227,0.28)',
      '--hover-surface': 'rgba(255,210,200,0.05)',
    },
  },
  {
    id: 'mocha',
    name: 'Mocha',
    previewColors: ['#20140f', '#2e1e15', '#5c4436', '#fb923c'],
    tokens: {
      '--bg-base': '#20140f',
      '--bg-elevated': 'rgba(48,32,23,0.82)',
      '--bg-overlay': '#2c1d15',
      '--bg-surface': 'rgba(255,180,120,0.035)',
      '--border-subtle': 'rgba(255,170,110,0.09)',
      '--border-hover': 'rgba(255,170,110,0.18)',
      '--text-primary': '#faf3ea',
      '--text-secondary': 'rgba(250,243,234,0.65)',
      '--text-muted': 'rgba(250,243,234,0.42)',
      '--text-faint': 'rgba(250,243,234,0.25)',
      '--hover-surface': 'rgba(255,170,110,0.06)',
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    previewColors: ['#0d1710', '#16241a', '#2f4a36', '#7bc47f'],
    tokens: {
      '--bg-base': '#0d1710',
      '--bg-elevated': 'rgba(24,40,29,0.82)',
      '--bg-overlay': '#16241a',
      // Alphas are solved against #0d1710 rather than picked, so the composited
      // result lands on the intended palette: surface -> #16231a, border-hover
      // -> #314936. border-subtle is the damped half of that same border ramp.
      '--bg-surface': 'rgba(163,230,175,0.06)',
      '--border-subtle': 'rgba(163,230,175,0.11)',
      '--border-hover': 'rgba(163,230,175,0.24)',
      '--text-primary': '#e6f2e6',
      '--text-secondary': 'rgba(230,242,230,0.66)',
      '--text-muted': 'rgba(230,242,230,0.45)',
      '--text-faint': 'rgba(230,242,230,0.26)',
      '--hover-surface': 'rgba(163,230,175,0.07)',
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
    const apply = () => {
      root.dataset.theme = mq.matches ? 'dark' : 'light'
    }
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
    accent: args.accentColor,
    success: args.successColor,
    warning: args.warningColor,
    danger: args.dangerColor,
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
