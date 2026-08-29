import { useEffect, useRef } from 'react'

interface Props {
  lines: string[]
  /** Tailwind max-height utility; the update dialog gives it more room. */
  maxHeight?: string
}

/**
 * The installer's output, following its own tail.
 *
 * Shared by the first-install modal and the loader update dialog, which render
 * the same `install:log` stream: the backend deliberately reuses that event for
 * an update so one view serves both (see `InstallerService.runInstaller`).
 */
export function InstallLog({ lines, maxHeight = 'max-h-40' }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight })
  }, [lines])

  if (lines.length === 0) return null

  return (
    <div
      ref={ref}
      className={`border-border-subtle bg-surface border-hairline overflow-y-auto rounded p-2 ${maxHeight}`}
    >
      {lines.map((line, i) => (
        <div key={i} className="text-text-muted text-2xs leading-relaxed break-all">
          {line}
        </div>
      ))}
    </div>
  )
}
