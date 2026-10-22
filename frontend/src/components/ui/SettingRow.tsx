import type { ReactNode } from 'react'

interface SettingRowProps {
  label: string
  /**
   * What the row reports right now: a missing prerequisite, a value the
   * setting is being overridden to. Never an explanation of the setting; the
   * label names it and the docs say the rest.
   */
  note?: string
  children: ReactNode
}

export function SettingRow({ label, note, children }: SettingRowProps) {
  return (
    <div className="border-border-subtle border-b-hairline flex items-center justify-between gap-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-text-primary text-sm">{label}</span>
        {note && <span className="text-text-muted text-xs">{note}</span>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
