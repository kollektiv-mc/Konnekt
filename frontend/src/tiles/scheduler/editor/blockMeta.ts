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

/**
 * What an unrecognised category or port is drawn in.
 *
 * The lookups below are keyed by strings the backend supplies, so every call
 * site needs an answer for one it does not know. Those answers were spelled out
 * as literals at twelve call sites across four files (#163), which is the same
 * value twelve chances to drift. The accessors are the single place instead.
 */
const PALETTE_FALLBACK = '#6b7280'
// Spelled out rather than interpolated from the value above. Tailwind extracts
// classes by scanning for literal strings, so a class built with a template
// literal is never compiled and the element renders with no colour at all.
const PALETTE_FALLBACK_TEXT_CLASS = 'text-[#6b7280]'
const PALETTE_FALLBACK_BORDER_CLASS = 'border-l-[#6b7280]'

/** An unnamed control input, distinct from the green of a completed output. */
export const CTRL_PORT_FALLBACK_IN = '#94a3b8'
/** An unnamed control output, which is nearly always a completion. */
export const CTRL_PORT_FALLBACK_OUT = CTRL_PORT_COLOR.onComplete
/** A data port whose type the graph could not resolve yet (portTypes.ts). */
export const UNRESOLVED_PORT_COLOR = PALETTE_FALLBACK

export const categoryColor = (cat: string): string => CATEGORY_COLOR[cat] ?? PALETTE_FALLBACK

export const categoryTextClass = (cat: string): string =>
  CATEGORY_TEXT_CLASS[cat] ?? PALETTE_FALLBACK_TEXT_CLASS

export const categoryBorderClass = (cat: string): string =>
  CATEGORY_BORDER_CLASS[cat] ?? PALETTE_FALLBACK_BORDER_CLASS

/** A data port's colour, defaulting to the string hue an untyped port carries. */
export const portTypeColor = (type: string): string =>
  PORT_TYPE_COLOR[type] ?? PORT_TYPE_COLOR.string

/**
 * The "(custom)" marker on an attribute the flow defined itself, rather than
 * one the server provides.
 *
 * Named here because it was a bare literal in NodeDataPanel that happened to be
 * CATEGORY_COLOR.trigger's value with nothing to do with triggers (#163), so
 * retuning the trigger hue would have silently moved it too. Like the rest of
 * this palette it does not follow applySkin(); a marker that did would need an
 * `info` token upstream in kollektiv/design/tokens.json, which is the
 * suite-wide change the audit defers rather than makes.
 */
export const CUSTOM_ATTR_TEXT_CLASS = 'text-[#7c3aed]'

/**
 * The stroke a data edge is drawn with, dashed to separate it from a control
 * edge at a glance.
 *
 * It is PORT_TYPE_COLOR.string rather than a colour of its own, because the
 * edge is the wire leaving a string port and the two have to agree. It was
 * spelled out as a literal in two separate files before (#163), so changing the
 * string port's colour left the edges behind.
 */
export const DATA_EDGE_STYLE = {
  strokeDasharray: '4 2',
  stroke: PORT_TYPE_COLOR.string,
} as const

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
