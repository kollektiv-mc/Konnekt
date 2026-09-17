import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from '../../lib/icons'
import { Icon } from './Icon'
import { Popover } from './Popover'
import { usePopover } from '../../hooks/usePopover'
import { filterOptions, typeaheadIndex, type ComboboxOption } from '../../lib/combobox'

/** How long a typeahead buffer survives between keystrokes, in ms. */
const TYPEAHEAD_RESET_MS = 700

interface ComboboxProps {
  value: string
  onChange: (value: string) => void
  options: ComboboxOption[]
  /**
   * Accept text that is not in `options`. The control is then a text input the
   * value flows through, and the list narrows as you type. Without it the value
   * is constrained to `options` and the control is a button, the way a
   * `<select>` is.
   */
  freeText?: boolean
  /**
   * Render the free-text half as a textarea. Only meaningful with `freeText`.
   *
   * It changes the keyboard contract, because a textarea already owns the keys
   * a combobox wants: while the list is closed every key goes to the textarea
   * untouched, so Enter inserts a newline and the arrows move the caret. The
   * list opens from the chevron or Alt+ArrowDown, and only once it is open do
   * the arrows and Enter drive it.
   */
  multiline?: boolean
  placeholder?: string
  /**
   * Labels the control for assistive tech. The panel's field labels are plain
   * `<label>` elements with no `htmlFor`, so there is nothing to associate and
   * the name has to come from here.
   */
  ariaLabel?: string
}

/**
 * The app's own dropdown, for fields that offer presets.
 *
 * It exists because a native `<select>` and an `<input list>`/`<datalist>` draw
 * their popups as platform chrome, which no stylesheet reaches: under
 * webkit2gtk (what Wails renders through on Linux) that means a GTK-themed
 * white list opening on top of a dark panel (#160). Rendering the list as page
 * content is the only fix, so this keeps what the native controls gave for
 * free — keyboard open, arrow navigation, type to filter, Escape to close —
 * rather than trading the bug for a worse control.
 *
 * The list is an absolutely positioned `Popover` inside the config panel's own
 * scroll container, so opening one near the bottom grows that container's
 * scroll rather than flipping the list upward. That is deliberate: a
 * body-portalled, viewport-positioned list is what `QuickAddMenu` does, and
 * #139 is the open bug about getting that right.
 */
export function Combobox({
  value,
  onChange,
  options,
  freeText,
  multiline,
  placeholder,
  ariaLabel,
}: ComboboxProps) {
  const { open, toggle, close } = usePopover()
  const [activeIndex, setActiveIndex] = useState(-1)
  // null means "not filtering" — the whole list shows. A string is what the
  // user has typed since opening, so picking a preset and reopening does not
  // leave the list narrowed to the one thing already chosen.
  const [query, setQuery] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const typeahead = useRef({ buffer: '', at: 0 })
  const listId = useId()

  const visible = useMemo(
    () => (freeText && query !== null ? filterOptions(options, query) : options),
    [freeText, query, options],
  )

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value

  const closeList = useCallback(() => {
    close()
    setQuery(null)
    setActiveIndex(-1)
  }, [close])

  const commit = useCallback(
    (opt: ComboboxOption) => {
      onChange(opt.value)
      closeList()
    },
    [onChange, closeList],
  )

  // Keep the highlighted row in view. jsdom has no layout, so scrollIntoView is
  // absent there and the optional call keeps tests off a polyfill.
  useEffect(() => {
    if (!open || activeIndex < 0) return
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeIndex])

  const openAt = useCallback(() => {
    const at = visible.findIndex((o) => o.value === value)
    setActiveIndex(at >= 0 ? at : 0)
    toggle()
  }, [visible, value, toggle])

  const move = useCallback(
    (delta: number) => {
      if (visible.length === 0) return
      setActiveIndex((i) => {
        const next = i < 0 ? (delta > 0 ? 0 : visible.length - 1) : i + delta
        return (next + visible.length) % visible.length
      })
    },
    [visible.length],
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    // A closed textarea owns its keys outright: Enter is a newline and the
    // arrows move the caret, so nothing below may intercept them. Alt+ArrowDown
    // is the one exception, the standard "open the list" chord.
    if (multiline && !open) {
      if (e.key === 'ArrowDown' && e.altKey) {
        e.preventDefault()
        openAt()
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!open) openAt()
        else move(1)
        return
      case 'ArrowUp':
        e.preventDefault()
        if (!open) openAt()
        else move(-1)
        return
      case 'Home':
        if (!open) return
        e.preventDefault()
        setActiveIndex(0)
        return
      case 'End':
        if (!open) return
        e.preventDefault()
        setActiveIndex(visible.length - 1)
        return
      case 'Enter':
        if (!open) {
          if (!freeText) {
            e.preventDefault()
            openAt()
          }
          return
        }
        e.preventDefault()
        if (activeIndex >= 0 && visible[activeIndex]) commit(visible[activeIndex])
        else closeList()
        return
      case 'Escape':
        if (!open) return
        e.preventDefault()
        // Stops the editor's own Escape handling (deselect, close panel) from
        // also firing on the keystroke that only meant "shut this list".
        e.stopPropagation()
        closeList()
        return
      case 'Tab':
        if (open) closeList()
        return
      case ' ':
        if (!freeText && !open) {
          e.preventDefault()
          openAt()
        }
        return
      default:
        break
    }

    // Typeahead, for the button control only: the input gets the character
    // itself and filters on it instead.
    if (freeText) return
    if (e.key.length !== 1 || e.altKey || e.ctrlKey || e.metaKey) return
    const now = Date.now()
    const buffer =
      now - typeahead.current.at > TYPEAHEAD_RESET_MS ? e.key : typeahead.current.buffer + e.key
    typeahead.current = { buffer, at: now }
    const from = buffer.length === 1 ? Math.max(activeIndex, 0) + 1 : Math.max(activeIndex, 0)
    const hit = typeaheadIndex(options, buffer, from)
    if (hit < 0) return
    e.preventDefault()
    if (open) setActiveIndex(hit)
    else onChange(options[hit].value)
  }

  const controlClass =
    'bg-surface border-border-subtle text-text-primary border-hairline w-full rounded px-2 py-1 text-left font-mono text-xs transition-colors outline-none'

  return (
    <div className="relative" onKeyDown={onKeyDown}>
      {freeText ? (
        <div className="relative">
          {multiline ? (
            <textarea
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-label={ariaLabel}
              value={value}
              placeholder={placeholder}
              rows={2}
              onChange={(e) => {
                onChange(e.target.value)
                setQuery(e.target.value)
                setActiveIndex(-1)
              }}
              className={`${controlClass} resize-none pr-6`}
            />
          ) : (
            <input
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-label={ariaLabel}
              value={value}
              placeholder={placeholder}
              onChange={(e) => {
                onChange(e.target.value)
                setQuery(e.target.value)
                setActiveIndex(-1)
                if (!open) toggle()
              }}
              className={`${controlClass} pr-6`}
            />
          )}
          <button
            type="button"
            tabIndex={-1}
            aria-label={`${ariaLabel ?? 'Options'}: show presets`}
            onClick={() => {
              setQuery(null)
              if (open) closeList()
              else openAt()
            }}
            className={`text-text-faint hover:text-text-secondary absolute top-0 right-0 flex cursor-pointer items-center bg-transparent px-1.5 transition-colors ${
              multiline ? 'pt-1.5' : 'h-full'
            }`}
          >
            <Icon icon={ChevronDown} size="xs" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={ariaLabel}
          onClick={() => (open ? closeList() : openAt())}
          className={`${controlClass} flex cursor-pointer items-center justify-between gap-1`}
        >
          <span className={selectedLabel ? '' : 'text-text-faint'}>
            {selectedLabel || placeholder || '—'}
          </span>
          <Icon icon={ChevronDown} size="xs" className="text-text-faint" />
        </button>
      )}

      <Popover open={open} onClose={closeList} align="left" width="100%" maxHeight={180}>
        <div ref={listRef} id={listId} role="listbox" aria-label={ariaLabel}>
          {visible.length === 0 ? (
            <div className="text-text-faint px-2 py-1.5 font-mono text-xs">No matches</div>
          ) : (
            visible.map((opt, i) => {
              const active = i === activeIndex
              const selected = opt.value === value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-active={active}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => commit(opt)}
                  className={`flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left font-mono text-xs transition-colors ${
                    active ? 'bg-hover' : 'bg-transparent'
                  } ${selected ? 'text-accent' : 'text-text-primary'}`}
                >
                  <Icon
                    icon={Check}
                    size="xs"
                    className={`text-accent ${selected ? 'opacity-100' : 'opacity-0'}`}
                  />
                  {opt.label}
                </button>
              )
            })
          )}
        </div>
      </Popover>
    </div>
  )
}
