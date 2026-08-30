interface Option<T extends string> {
  value: T
  label: string
  /** Rendered greyed and unclickable. The caller is responsible for saying why. */
  disabled?: boolean
}

interface SegmentedProps<T extends string> {
  options: Option<T>[]
  value: T
  onChange: (v: T) => void
  compact?: boolean
  slide?: boolean
}

// An inactive segment sits transparent on the track's own `bg-hover`, so a
// second `bg-hover` on top composites to a visibly lighter step rather than
// painting the same colour twice. The slide variant deliberately takes the text
// half only: its accent pill is absolutely positioned *under* the buttons, and a
// background on a hovered segment would occlude the pill as it travels past.
const HOVER = 'hover:bg-hover hover:text-text-primary'
const HOVER_TEXT_ONLY = 'hover:text-text-primary'

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  compact,
  slide,
}: SegmentedProps<T>) {
  const activeIndex = options.findIndex((o) => o.value === value)

  if (slide) {
    return (
      <div className="border-border-subtle bg-hover border-hairline relative flex shrink-0 overflow-hidden rounded-lg">
        <div
          className="bg-accent absolute top-0 bottom-0 rounded-[7px]"
          // eslint-disable-next-line no-restricted-syntax -- width/transform computed from options.length and activeIndex, not visible to Tailwind's static scanner
          style={{
            width: `${100 / options.length}%`,
            transform: `translateX(${activeIndex * 100}%)`,
            transition: 'transform 200ms var(--ease-standard)',
          }}
        />
        {options.map((opt) => {
          const active = opt.value === value
          return (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              disabled={opt.disabled}
              className={`relative z-10 flex-1 cursor-pointer bg-transparent text-xs whitespace-nowrap transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
                compact ? 'px-2 py-px' : 'px-3 py-1'
              } ${
                active
                  ? 'text-canvas font-semibold'
                  : `text-text-muted font-normal ${opt.disabled ? '' : HOVER_TEXT_ONLY}`
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="border-border-subtle bg-hover border-hairline flex shrink-0 overflow-hidden rounded-lg">
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            disabled={opt.disabled}
            className={`cursor-pointer text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              compact ? 'px-2 py-px' : 'px-3 py-1'
            } ${
              active
                ? 'bg-accent text-canvas font-semibold'
                : `text-text-muted bg-transparent font-normal ${opt.disabled ? '' : HOVER}`
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
