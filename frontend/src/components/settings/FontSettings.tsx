import { useEffect, useMemo, useRef, useState } from 'react'
import { ListFontFamilies } from '../../../wailsjs/go/main/App'
import { Combobox } from '../ui/Combobox'
import { readOr } from '../../lib/ipc'
import { FONT_ROLES, normalizeFonts, type FontChoice, type FontRole } from '../../lib/fonts'

const ROLE_LABELS: Record<FontRole, string> = {
  sans: 'Body',
  title: 'Titles',
  display: 'Wordmark',
  mono: 'Code',
}

/**
 * How long typing may pause before the choice is applied and written. Every
 * keystroke in the field is a change, and a change is a write to
 * app_settings.json, so "Fira Code" would otherwise be nine of them and nine
 * repaints of the whole document.
 */
const COMMIT_DELAY_MS = 400

const NO_OPTIONS: never[] = []

interface Props {
  /** `AppSettings.fonts`, as stored. */
  fonts: Record<string, string>
  /** Persist a new choice. Rejections are the caller's to record. */
  onChange: (fonts: Record<string, string>) => void
}

/** A choice as the settings file stores it: only the roles that have a family. */
function toStored(choice: FontChoice): Record<string, string> {
  const stored: Record<string, string> = {}
  for (const role of FONT_ROLES) {
    const family = choice[role]
    if (family) stored[role] = family
  }
  return stored
}

/**
 * One field per `--font-*` token, each suggesting the installed families.
 *
 * A field that takes any name, with the installed list as suggestions, rather
 * than a select limited to the list: the list cannot see every font a machine
 * renders (a face a person installed a moment ago, one the OS keeps outside the
 * directories Go reads), and a select would make those unchoosable. An empty
 * field is the default, so there is nothing separate to reset. A name that is
 * not installed does no harm: lib/fonts.ts writes it in front of the token's
 * own stack, so the browser falls through to the default.
 *
 * Offered on the desktop only. The list is the desktop's fonts, and a browser
 * served by Remote Access neither shares them nor persists a settings write.
 * SettingsModal does not render this there.
 */
export function FontSettings({ fonts, onChange }: Props) {
  const [families, setFamilies] = useState<string[]>([])
  const [listed, setListed] = useState(false)
  // What the fields show. It runs ahead of `fonts` while a commit is pending,
  // and is the source of truth for the fields otherwise, so a field never
  // snaps back to the stored value in the middle of typing.
  const [draft, setDraft] = useState<FontChoice>(() => normalizeFonts(fonts))
  // The same value, readable inside a handler that fires twice before a render.
  const draftRef = useRef(draft)
  const pending = useRef<{ timer: number; choice: FontChoice } | null>(null)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    let live = true
    // Through readOr: with no Wails bridge (the frontend-dev preview) the
    // binding throws instead of rejecting, and the fields still take a name.
    void readOr(ListFontFamilies, []).then((names) => {
      if (!live) return
      // An array or nothing: Go never sends null here, but a bridge that is
      // not ours (the browser demo, a mocked binding) is not held to that.
      setFamilies(Array.isArray(names) ? names : [])
      setListed(true)
    })
    return () => {
      live = false
    }
  }, [])

  // A pending choice is written when the section goes away rather than lost:
  // closing Settings within the delay of the last keystroke is ordinary.
  useEffect(
    () => () => {
      const waiting = pending.current
      if (!waiting) return
      window.clearTimeout(waiting.timer)
      pending.current = null
      onChangeRef.current(toStored(waiting.choice))
    },
    [],
  )

  const options = useMemo(() => families.map((name) => ({ value: name, label: name })), [families])
  // Combobox keeps its list in the DOM, hidden, for the open animation, so four
  // of them would hold four copies of a few hundred rows (each with an icon)
  // for as long as Appearance is on screen. Only the field the person last
  // pointed at or focused gets the list; focus or a press is always what comes
  // before it opens.
  const [active, setActive] = useState<FontRole | null>(null)

  const choose = (role: FontRole, family: string) => {
    const next: FontChoice = { ...draftRef.current, [role]: family }
    draftRef.current = next
    setDraft(next)
    // The cleaned form is what is applied and stored; the draft keeps what was
    // typed, so a trailing space mid-name is not eaten under the cursor.
    const choice = normalizeFonts(next)
    if (pending.current) window.clearTimeout(pending.current.timer)
    const timer = window.setTimeout(() => {
      pending.current = null
      onChangeRef.current(toStored(choice))
    }, COMMIT_DELAY_MS)
    pending.current = { timer, choice }
  }

  return (
    <div className="border-border-subtle border-b-hairline py-3">
      <span className="text-text-primary text-sm">Fonts</span>
      <p className="text-text-muted mt-0.5 mb-3 text-xs">
        Installed fonts, or any name you type. Empty is the default; a name that is not installed
        falls back to it.
      </p>
      <div className="flex flex-col gap-2">
        {FONT_ROLES.map((role) => (
          <div
            key={role}
            className="flex items-center gap-3"
            onPointerDownCapture={() => setActive(role)}
            onFocusCapture={() => setActive(role)}
          >
            <span className="text-text-secondary w-20 shrink-0 text-xs">{ROLE_LABELS[role]}</span>
            <div className="min-w-0 flex-1">
              <Combobox
                freeText
                ariaLabel={ROLE_LABELS[role]}
                placeholder="Default"
                value={draft[role] ?? ''}
                options={active === role ? options : NO_OPTIONS}
                onChange={(family) => choose(role, family)}
              />
            </div>
          </div>
        ))}
      </div>
      {listed && families.length === 0 && (
        <p className="text-text-muted mt-2 text-xs">
          No installed fonts could be listed. Type the name of one.
        </p>
      )}
    </div>
  )
}
