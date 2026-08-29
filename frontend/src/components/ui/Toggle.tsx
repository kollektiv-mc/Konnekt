interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}

export function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      // The off-state hover steps --border-hover (0.12) up to --text-faint
      // (0.25) rather than inventing a value between them; the on-state dims the
      // accent instead of brightening it, since a saturated fill has nowhere up
      // to go. Both are no-ops while disabled, where the cursor says so instead.
      className={`relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked
          ? 'bg-accent enabled:hover:bg-accent/85'
          : 'bg-border-hover enabled:hover:bg-text-faint'
      }`}
    >
      <span
        className={`bg-canvas absolute top-0.5 left-0.5 h-4 w-4 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  )
}
