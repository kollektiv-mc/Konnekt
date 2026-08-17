import type { ReactNode } from 'react'

interface SettingRowProps {
  label: string
  description?: string
  children: ReactNode
}

export function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="border-border-subtle border-b-hairline flex items-center justify-between gap-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-text-primary text-sm">{label}</span>
        {description && <span className="text-text-muted text-xs">{description}</span>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
