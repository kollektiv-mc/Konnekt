import { useState, useRef, useEffect, useCallback } from 'react'
import type { ConfigField } from './inferType'

// Shared chrome for text-style inputs (TextInput, TextArea, Select's trigger,
// ChipList's chips) — file-local since nothing outside form/ consumes it.
const FIELD_INPUT_CLASS = 'bg-hover-surface text-text-primary border border-border-subtle'

/* ── Shared row wrapper ───────────────────────────────────── */
function FieldRow({ field, children }: { field: ConfigField; children: React.ReactNode }) {
  return (
    <div className="border-border-subtle flex flex-col gap-1 border-b py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-text-primary min-w-0 flex-1 text-sm font-medium">{field.label}</span>
        <div className="flex-shrink-0">{children}</div>
      </div>
      {field.description && (
        <p className="text-text-faint pr-1 text-xs leading-relaxed">{field.description}</p>
      )}
    </div>
  )
}

/* ── Toggle ───────────────────────────────────────────────── */
export function Toggle({
  field,
  onChange,
}: {
  field: ConfigField
  onChange: (v: boolean) => void
}) {
  const on = field.value === true || field.value === 'true'
  return (
    <FieldRow field={field}>
      <button
        onClick={() => onChange(!on)}
        role="switch"
        aria-checked={on}
        className={`relative h-5 w-10 flex-shrink-0 rounded-full transition-colors duration-200 focus:outline-none ${
          on ? 'bg-accent' : 'bg-hover-surface'
        }`}
      >
        {/* Pin dot to left-0.5 (2px) so translateX is relative to that anchor */}
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full transition-transform duration-200 ${
            on ? 'translate-x-5 bg-black' : 'bg-text-muted translate-x-0'
          }`}
        />
      </button>
    </FieldRow>
  )
}

/* ── NumberInput ──────────────────────────────────────────── */
export function NumberInput({
  field,
  onChange,
}: {
  field: ConfigField
  onChange: (v: number) => void
}) {
  const [draft, setDraft] = useState(String(field.value ?? ''))

  function commit(raw: string) {
    const n = Number(raw)
    if (!Number.isNaN(n)) {
      const clamped =
        field.min !== undefined && n < field.min
          ? field.min
          : field.max !== undefined && n > field.max
            ? field.max
            : n
      onChange(clamped)
      setDraft(String(clamped))
    } else {
      setDraft(String(field.value ?? ''))
    }
  }

  function step(delta: number) {
    const base = Number(draft)
    const next = (Number.isNaN(base) ? 0 : base) + delta
    commit(String(next))
  }

  const spinnerBtnClass = 'text-text-muted bg-transparent leading-none'

  return (
    <FieldRow field={field}>
      <div className="border-border-subtle bg-hover-surface flex items-center overflow-hidden rounded border">
        <input
          type="number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
          className="text-text-primary w-20 bg-transparent px-2 py-1 text-right font-mono text-sm outline-none"
          // eslint-disable-next-line no-restricted-syntax -- suppresses native number spinners; no Tailwind utility targets -moz-appearance/-webkit-appearance
          style={{ MozAppearance: 'textfield', WebkitAppearance: 'none' }}
        />
        <div className="border-border-subtle ml-1 flex flex-shrink-0 flex-col border-l">
          <button
            onClick={() => step(1)}
            className={`hover:text-accent px-1.5 py-0.5 text-[10px] transition-colors ${spinnerBtnClass}`}
            tabIndex={-1}
          >
            ▲
          </button>
          <button
            onClick={() => step(-1)}
            className={`border-border-subtle hover:text-accent border-t px-1.5 py-0.5 text-[10px] transition-colors ${spinnerBtnClass}`}
            tabIndex={-1}
          >
            ▼
          </button>
        </div>
      </div>
    </FieldRow>
  )
}

/* ── TextInput ────────────────────────────────────────────── */
export function TextInput({
  field,
  onChange,
}: {
  field: ConfigField
  onChange: (v: string) => void
}) {
  return (
    <FieldRow field={field}>
      <input
        type="text"
        defaultValue={String(field.value ?? '')}
        onBlur={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onChange((e.target as HTMLInputElement).value)}
        className={`w-48 rounded px-2 py-1 font-mono text-sm outline-none ${FIELD_INPUT_CLASS}`}
      />
    </FieldRow>
  )
}

/* ── TextArea ─────────────────────────────────────────────── */
export function TextArea({
  field,
  onChange,
}: {
  field: ConfigField
  onChange: (v: string) => void
}) {
  return (
    <div className="border-border-subtle flex flex-col gap-2 border-b py-3">
      <span className="text-text-primary text-sm font-medium">{field.label}</span>
      {field.description && <p className="text-text-faint text-xs">{field.description}</p>}
      <textarea
        defaultValue={String(field.value ?? '')}
        onBlur={(e) => onChange(e.target.value)}
        rows={3}
        className={`w-full resize-y rounded px-2 py-1.5 font-mono text-sm outline-none ${FIELD_INPUT_CLASS}`}
      />
    </div>
  )
}

/* ── Select ───────────────────────────────────────────────── */
export function Select({ field, onChange }: { field: ConfigField; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const current = String(field.value ?? '')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <FieldRow field={field}>
      <div ref={ref} className="relative min-w-32">
        {/* Trigger */}
        <button
          onClick={() => setOpen((o) => !o)}
          className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 font-mono text-sm ${FIELD_INPUT_CLASS}`}
        >
          <span>{current}</span>
          <span className="text-[10px] opacity-50">{open ? '▲' : '▼'}</span>
        </button>

        {/* Dropdown panel. Opaque on purpose: it covers the form behind it, so
            bg-elevated is wrong here at alpha 0.82 in both skins. */}
        {open && (
          <div className="border-border-subtle bg-overlay absolute top-[calc(100%+4px)] right-0 z-50 min-w-full overflow-hidden rounded border shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
            {field.options?.map((opt) => (
              <button
                key={opt}
                onClick={() => {
                  onChange(opt)
                  setOpen(false)
                }}
                className={`w-full px-3 py-1.5 text-left font-mono text-sm transition-colors ${
                  opt === current ? 'bg-accent text-black' : 'text-text-primary bg-transparent'
                }`}
                onMouseEnter={(e) => {
                  if (opt !== current)
                    (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'
                }}
                onMouseLeave={(e) => {
                  if (opt !== current)
                    (e.currentTarget as HTMLElement).style.background = 'transparent'
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>
    </FieldRow>
  )
}

/* ── ChipList ─────────────────────────────────────────────── */
export function ChipList({
  field,
  onChange,
}: {
  field: ConfigField
  onChange: (v: string[]) => void
}) {
  const items = Array.isArray(field.value) ? (field.value as string[]) : []
  const [draft, setDraft] = useState('')

  function add() {
    const val = draft.trim()
    if (!val || items.includes(val)) return
    onChange([...items, val])
    setDraft('')
  }

  return (
    <div className="border-border-subtle flex flex-col gap-2 border-b py-3">
      <span className="text-text-primary text-sm font-medium">{field.label}</span>
      {field.description && <p className="text-text-faint text-xs">{field.description}</p>}
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, idx) => (
          <span
            key={idx}
            className={`flex items-center gap-1 rounded px-2 py-0.5 font-mono text-xs ${FIELD_INPUT_CLASS}`}
          >
            {String(item)}
            <button
              onClick={() => onChange(items.filter((_, i) => i !== idx))}
              className="text-text-muted opacity-50 transition-opacity hover:opacity-100"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Add…"
          className="bg-hover-surface text-text-primary border-border-subtle min-w-16 rounded border border-dashed px-2 py-0.5 font-mono text-xs outline-none"
        />
      </div>
    </div>
  )
}

/* ── MOTD Builder ─────────────────────────────────────────── */

const MC_COLORS: { code: string; hex: string; label: string }[] = [
  { code: '0', hex: '#000000', label: 'Black' },
  { code: '1', hex: '#0000AA', label: 'Dark Blue' },
  { code: '2', hex: '#00AA00', label: 'Dark Green' },
  { code: '3', hex: '#00AAAA', label: 'Dark Aqua' },
  { code: '4', hex: '#AA0000', label: 'Dark Red' },
  { code: '5', hex: '#AA00AA', label: 'Dark Purple' },
  { code: '6', hex: '#FFAA00', label: 'Gold' },
  { code: '7', hex: '#AAAAAA', label: 'Gray' },
  { code: '8', hex: '#555555', label: 'Dark Gray' },
  { code: '9', hex: '#5555FF', label: 'Blue' },
  { code: 'a', hex: '#55FF55', label: 'Green' },
  { code: 'b', hex: '#55FFFF', label: 'Aqua' },
  { code: 'c', hex: '#FF5555', label: 'Red' },
  { code: 'd', hex: '#FF55FF', label: 'Light Purple' },
  { code: 'e', hex: '#FFFF55', label: 'Yellow' },
  { code: 'f', hex: '#FFFFFF', label: 'White' },
]

const COLOR_MAP: Record<string, string> = Object.fromEntries(
  MC_COLORS.map(({ code, hex }) => [code, hex]),
)

const FORMAT_BUTTONS: Array<{ code: string; label: string; title: string; className?: string }> = [
  { code: '§l', label: 'B', title: 'Bold', className: 'font-bold' },
  { code: '§o', label: 'I', title: 'Italic', className: 'italic' },
  { code: '§n', label: 'U', title: 'Underline', className: 'underline' },
  { code: '§m', label: 'S', title: 'Strikethrough', className: 'line-through' },
  { code: '§k', label: '✦', title: 'Obfuscated' },
]

interface MotdSegment {
  text: string
  color: string | null
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  obfuscated: boolean
}

function parseMotdLine(raw: string): MotdSegment[] {
  // Normalise § unicode escapes to § before parsing
  const input = raw.replace(/\\u00a7/gi, '§')
  const segments: MotdSegment[] = []
  let cur: MotdSegment = {
    text: '',
    color: null,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    obfuscated: false,
  }

  let i = 0
  while (i < input.length) {
    if (input[i] === '§' && i + 1 < input.length) {
      if (cur.text) {
        segments.push({ ...cur })
        cur = { ...cur, text: '' }
      }
      const c = input[i + 1].toLowerCase()
      if (COLOR_MAP[c] !== undefined) {
        cur = {
          text: '',
          color: COLOR_MAP[c],
          bold: false,
          italic: false,
          underline: false,
          strike: false,
          obfuscated: false,
        }
      } else if (c === 'l') cur = { ...cur, bold: true, text: '' }
      else if (c === 'o') cur = { ...cur, italic: true, text: '' }
      else if (c === 'n') cur = { ...cur, underline: true, text: '' }
      else if (c === 'm') cur = { ...cur, strike: true, text: '' }
      else if (c === 'k') cur = { ...cur, obfuscated: true, text: '' }
      else if (c === 'r')
        cur = {
          text: '',
          color: null,
          bold: false,
          italic: false,
          underline: false,
          strike: false,
          obfuscated: false,
        }
      i += 2
    } else {
      cur.text += input[i]
      i++
    }
  }
  if (cur.text) segments.push(cur)
  return segments
}

function MotdPreviewLine({ raw, placeholder }: { raw: string; placeholder?: string }) {
  const segments = parseMotdLine(raw)
  if (!segments.length) {
    return <span className="text-text-faint italic">{placeholder ?? ' '}</span>
  }
  return (
    <>
      {segments.map((seg, i) => {
        const decoration = [seg.underline && 'underline', seg.strike && 'line-through']
          .filter(Boolean)
          .join(' ')
        return (
          <span
            key={i}
            // eslint-disable-next-line no-restricted-syntax -- per-segment styling parsed from Minecraft MOTD formatting codes, continuously variable
            style={{
              color: seg.color ?? 'var(--text-primary)',
              fontWeight: seg.bold ? 'bold' : undefined,
              fontStyle: seg.italic ? 'italic' : undefined,
              textDecoration: decoration || undefined,
              opacity: seg.obfuscated ? 0.6 : undefined,
              letterSpacing: seg.obfuscated ? '0.05em' : undefined,
            }}
          >
            {seg.obfuscated ? seg.text.replace(/\S/g, '?') : seg.text}
          </span>
        )
      })}
    </>
  )
}

function splitMotd(raw: string): [string, string] {
  const idx = raw.indexOf('\\n')
  if (idx === -1) return [raw, '']
  return [raw.slice(0, idx), raw.slice(idx + 2)]
}

export function MotdWidget({
  field,
  onChange,
}: {
  field: ConfigField
  onChange: (v: string) => void
}) {
  const rawValue = String(field.value ?? '')
  const [expanded, setExpanded] = useState(false)

  const [l1, setL1] = useState(() => splitMotd(rawValue)[0])
  const [l2, setL2] = useState(() => splitMotd(rawValue)[1])
  const l1Ref = useRef<HTMLInputElement>(null)
  const l2Ref = useRef<HTMLInputElement>(null)
  const focusedLine = useRef<1 | 2>(1)

  // Sync when field.value changes externally (revert / file reload)
  useEffect(() => {
    const [a, b] = splitMotd(String(field.value ?? ''))
    setL1(a)
    setL2(b)
  }, [field.value])

  const emit = useCallback(
    (a: string, b: string) => {
      onChange(b ? a + '\\n' + b : a)
    },
    [onChange],
  )

  function insertCode(code: string) {
    const isL1 = focusedLine.current === 1
    const ref = isL1 ? l1Ref : l2Ref
    const val = isL1 ? l1 : l2
    const set = isL1 ? setL1 : setL2

    const input = ref.current
    const start = input?.selectionStart ?? val.length
    const end = input?.selectionEnd ?? start
    const next = val.slice(0, start) + code + val.slice(end)
    set(next)
    emit(isL1 ? next : l1, isL1 ? l2 : next)

    if (input) {
      requestAnimationFrame(() => {
        input.focus()
        const pos = start + code.length
        input.setSelectionRange(pos, pos)
      })
    }
  }

  const inputClass = 'flex-1 px-2 py-1 text-sm font-mono rounded outline-none'

  return (
    <div className="border-border-subtle border-b">
      {/* Always-visible collapsed row */}
      <div className="flex items-center gap-3 py-3">
        <span className="text-text-primary flex-shrink-0 text-sm font-medium">{field.label}</span>
        <div
          className="bg-hover-surface min-w-0 flex-1 cursor-pointer truncate rounded px-2 py-1 font-mono text-sm"
          onClick={() => setExpanded(true)}
        >
          <MotdPreviewLine raw={l1} placeholder="A Minecraft Server" />
        </div>
        <button
          onClick={() => setExpanded((o) => !o)}
          className="border-border-subtle text-text-muted flex-shrink-0 rounded border px-2 py-1 font-mono text-[10px] transition-colors"
        >
          {expanded ? '▲ Done' : '▼ Edit'}
        </button>
      </div>

      {field.description && !expanded && (
        <p className="text-text-faint pb-2 text-xs">{field.description}</p>
      )}

      {/* Expanded editor */}
      {expanded && (
        <div className="flex flex-col gap-3 pb-4">
          {/* Preview */}
          <div className="bg-surface border-border-subtle flex flex-col gap-0.5 rounded border px-3 py-2 font-mono text-sm">
            <div>
              <MotdPreviewLine raw={l1} placeholder="Line 1…" />
            </div>
            <div>
              <MotdPreviewLine raw={l2} placeholder={l2 ? undefined : ' '} />
            </div>
          </div>

          {/* Color palette */}
          <div className="flex flex-col gap-1.5">
            <span className="text-text-faint text-[10px] font-semibold tracking-widest uppercase">
              Color
            </span>
            <div className="flex flex-wrap gap-1.5">
              {MC_COLORS.map(({ code, hex, label }) => (
                <button
                  key={code}
                  title={`${label}  §${code}`}
                  onClick={() => insertCode(`§${code}`)}
                  className="h-5 w-5 flex-shrink-0 rounded-full transition-transform hover:scale-110 focus:outline-none"
                  // eslint-disable-next-line no-restricted-syntax -- per-swatch color from the MC_COLORS data table; can't be static Tailwind classes
                  style={{
                    background: hex,
                    boxShadow:
                      hex === '#000000' ? 'inset 0 0 0 1px rgba(255,255,255,0.2)' : undefined,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Style buttons */}
          <div className="flex flex-col gap-1.5">
            <span className="text-text-faint text-[10px] font-semibold tracking-widest uppercase">
              Style
            </span>
            <div className="flex items-center gap-1.5">
              {FORMAT_BUTTONS.map(({ code, label, title, className }) => (
                <button
                  key={code}
                  title={`${title}  ${code}`}
                  onClick={() => insertCode(code)}
                  className={`border-border-subtle text-text-muted hover:text-accent h-7 w-8 rounded border bg-transparent font-mono text-xs transition-colors focus:outline-none ${className ?? ''}`}
                >
                  {label}
                </button>
              ))}
              <div className="bg-border-subtle mx-0.5 h-5 w-px" />
              <button
                title="Reset  §r"
                onClick={() => insertCode('§r')}
                className="border-border-subtle text-text-faint hover:text-accent h-7 rounded border bg-transparent px-2 font-mono text-xs transition-colors focus:outline-none"
              >
                ↺ Reset
              </button>
            </div>
          </div>

          {/* Line inputs */}
          <div className="flex flex-col gap-2">
            {(
              [
                {
                  label: 'Line 1',
                  val: l1,
                  ref: l1Ref,
                  set: setL1,
                  line: 1 as const,
                  placeholder: 'A Minecraft Server',
                },
                {
                  label: 'Line 2',
                  val: l2,
                  ref: l2Ref,
                  set: setL2,
                  line: 2 as const,
                  placeholder: 'Optional second line…',
                },
              ] as const
            ).map(({ label, val, ref, set, line, placeholder }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-text-faint w-12 flex-shrink-0 text-right font-mono text-xs">
                  {label}
                </span>
                <input
                  ref={ref}
                  type="text"
                  value={val}
                  placeholder={placeholder}
                  onChange={(e) => {
                    set(e.target.value)
                    emit(line === 1 ? e.target.value : l1, line === 2 ? e.target.value : l2)
                  }}
                  onFocus={() => {
                    focusedLine.current = line
                  }}
                  className={`${inputClass} ${FIELD_INPUT_CLASS}`}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
