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
  placeholder?: string
  /**
   * Labels the control for assistive tech. The panel's field labels are plain
   * `<label>` elements with no `htmlFor`, so there is nothing to associate and
   * the name has to come from here.
   */
  ariaLabel?: string
  /**
   * With `freeText`, show a matched option's label instead of the raw value
   * while the field is not being edited, and the raw value the moment it is.
   *
   * For fields whose list holds values a user is not meant to read: the command
   * field's lifecycle presets are the sentinels `__start__`, `__stop__` and
   * `__restart__`, which are switch cases rather than commands, so the node
   * would otherwise display an internal token where a command belongs (#161).
   *
   * Opt-in, because for a field whose labels are merely a decorated spelling of
   * its values — the attribute list showing `@tps` for `tps` — swapping one for
   * the other on blur teaches the same mismatch #162 is about.
   */
  showOptionLabel?: boolean
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
  placeholder,
  ariaLabel,
  showOptionLabel,
}: ComboboxProps) {
  const { open, toggle, close } = usePopover()
  const [activeIndex, setActiveIndex] = useState(-1)
  // null means "not filtering" — the whole list shows. A string is what the
  // user has typed since opening, so picking a preset and reopening does not
  // leave the list narrowed to the one thing already chosen.
  const [query, setQuery] = useState<string | null>(null)
  // Only ever read under showOptionLabel: an unfocused field shows the label,
  // and focusing it reveals the value it stands for, so what runs stays one
  // click away rather than hidden behind a friendly name.
  const [focused, setFocused] = useState(false)
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

  // The same editable-field pattern the config panel's FIELD_CLASS wears, so a
  // preset field and a plain one are the same control (#163): bg-hover, and a
  // border that answers hover and focus rather than a transition with nothing
  // to transition.
  const controlClass =
    'bg-hover border-border-subtle text-text-primary hover:border-border-hover focus:border-border-hover border-hairline w-full rounded px-2 py-1 text-left font-mono text-xs transition-colors outline-none'

  return (
    <div className="relative" onKeyDown={onKeyDown}>
      {freeText ? (
        <div className="relative">
          <input
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label={ariaLabel}
            value={showOptionLabel && !focused ? selectedLabel : value}
            placeholder={placeholder}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              onChange(e.target.value)
              setQuery(e.target.value)
              setActiveIndex(-1)
              if (!open) toggle()
            }}
            className={`${controlClass} pr-6`}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label={`${ariaLabel ?? 'Options'}: show presets`}
            onClick={() => {
              setQuery(null)
              if (open) closeList()
              else openAt()
            }}
            className="text-text-faint hover:text-text-secondary absolute top-0 right-0 flex h-full cursor-pointer items-center bg-transparent px-1.5 transition-colors"
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
