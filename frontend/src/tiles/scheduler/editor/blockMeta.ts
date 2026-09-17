import type { models } from '../../../../wailsjs/go/models'

export const CATEGORY_ORDER = ['trigger', 'data', 'action', 'control', 'notify']

export function orderedCategories(defs: { category: string }[]): string[] {
  const present = [...new Set(defs.map((d) => d.category))]
  return [
    ...CATEGORY_ORDER.filter((c) => present.includes(c)),
    ...present.filter((c) => !CATEGORY_ORDER.includes(c)),
  ]
}

export const CATEGORY_COLOR: Record<string, string> = {
  trigger: '#7c3aed',
  action: '#0369a1',
  control: '#b45309',
  notify: '#047857',
  data: '#0e7490',
}

// Tailwind arbitrary-value classes mirroring CATEGORY_COLOR's hex values —
// Tailwind v4's default palette is OKLCH-based and doesn't render pixel-identical
// to these hex literals, so there's no stock named-color equivalent.
export const CATEGORY_TEXT_CLASS: Record<string, string> = {
  trigger: 'text-[#7c3aed]',
  action: 'text-[#0369a1]',
  control: 'text-[#b45309]',
  notify: 'text-[#047857]',
  data: 'text-[#0e7490]',
}

export const CATEGORY_BORDER_CLASS: Record<string, string> = {
  trigger: 'border-l-[#7c3aed]',
  action: 'border-l-[#0369a1]',
  control: 'border-l-[#b45309]',
  notify: 'border-l-[#047857]',
  data: 'border-l-[#0e7490]',
}

// ASCII icons — no emoji
export const CATEGORY_ICON: Record<string, string> = {
  trigger: '!',
  action: '>',
  control: '?',
  notify: '#',
  data: '*',
}

// Rounded circle handles for control ports
export const CTRL_PORT_COLOR: Record<string, string> = {
  trigger: '#7c3aed',
  onComplete: '#22c55e',
  onFailed: '#ef4444',
  onTrue: '#22c55e',
  onFalse: '#f97316',
}

// Square handles for data ports; colored by data type
export const PORT_TYPE_COLOR: Record<string, string> = {
  string: '#60a5fa',
  number: '#a3e635',
  bool: '#fb923c',
}

// The "wired" badge on a field label, and the read-only row that replaces the
// control when a data edge supplies the value.
//
// Blue because that is what a string data port is drawn in
// (PORT_TYPE_COLOR.string above): the badge exists to point at that edge, so it
// tracks the edge's own colour rather than introducing a second one. Like the
// rest of this palette these are literals rather than design tokens, and for
// the same reason the file's earlier comment gives — the graph's colours are
// its own, and the token layer deliberately does not name them. That does mean
// the badge does not follow applySkin(); making it follow would need an `info`
// token added upstream in kollektiv/design/tokens.json, which is a suite-wide
// change rather than a Konnekt one (#163).
export const WIRED_BG_CLASS = 'bg-[#1e3a5f]'
export const WIRED_BORDER_CLASS = 'border-[#1e3a5f]'
export const WIRED_TEXT_CLASS = 'text-[#60a5fa]'

/**
 * The one config value a node shows under its title: the first non-empty
 * required field.
 *
 * A command field is read through its own options first, because its lifecycle
 * presets are sentinels execCommand switches on rather than commands it sends:
 * a node reading "__restart__" says less about what it does than "Restart
 * Server" (#161). Anything with no matching option, which is every command a
 * user typed, is its own label already.
 *
 * Only command fields. Other lists label a value with a decorated spelling of
 * itself, the attribute list showing `@tps` for `tps`, and resolving those here
 * would put the @ form on the node while the field holds the bare one, which is
 * the mismatch #162 is open about.
 */
export function configHint(
  def: models.BlockDef | undefined,
  config: Record<string, unknown> | undefined,
): unknown {
  return def?.configSchema
    ?.filter((f) => f.required && f.key !== '_collapsed')
    .map((f) => {
      const v = config?.[f.key]
      if (f.type !== 'command' || v === undefined || v === '') return v
      return f.options?.find((o) => o.value === v)?.label ?? v
    })
    .find((v) => v !== undefined && v !== '')
}

/**
 * React Flow's opt-out class, on every piece of editor chrome.
 *
 * Its key handling is bound to `document`, not to the canvas, and the only
 * thing that stops it is `isInputDOMNode`: INPUT, SELECT, TEXTAREA,
 * contenteditable, or anything inside an element carrying this class. A BUTTON
 * is none of those, and the library only checks for one to decide whether to
 * call preventDefault, not whether to act.
 *
 * That matters since Backspace joined Delete as a delete key (#159). The config
 * panel's preset fields are buttons now rather than native selects (#160), and
 * the panel is showing the selected node, so a Backspace meant for a field
 * would have deleted the very node being edited. The toolbar, palette and
 * quick-add menu are all buttons too.
 */
export const NO_GRAPH_KEYS = 'nokey'
