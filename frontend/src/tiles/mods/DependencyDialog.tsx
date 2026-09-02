import { useEffect, useState } from 'react'
import type { ResolvedDependency } from './useMods'

interface Props {
  primaryVersionId: string
  dependencies: ResolvedDependency[]
  onConfirm: (versionIds: string[]) => void
  onCancel: () => void
}

export function DependencyDialog({ primaryVersionId, dependencies, onConfirm, onCancel }: Props) {
  // required deps are auto-selected and locked; optional are toggleable
  const [optionalSelected, setOptionalSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  const toggleOptional = (versionId: string) => {
    setOptionalSelected((prev) => {
      const next = new Set(prev)
      if (next.has(versionId)) next.delete(versionId)
      else next.add(versionId)
      return next
    })
  }

  const handleConfirm = () => {
    const ids = [primaryVersionId]
    for (const dep of dependencies) {
      if (dep.alreadyInstalled) continue
      if (dep.required || optionalSelected.has(dep.version.id)) {
        ids.push(dep.version.id)
      }
    }
    onConfirm(ids)
  }

  const required = dependencies.filter((d) => d.required)
  const optional = dependencies.filter((d) => !d.required)

  // z-dialog because ModPreviewDialog (z-modal) is one of the surfaces that
  // opens this, and it renders before that dialog's backdrop, so the value is
  // what carries it (lib/layers.ts). Before the scale this was z-50 under a
  // z-[400] backdrop: switching the version of a mod with a missing dependency
  // showed nothing but a second dim layer over the page, and the next click
  // landed on the backdrop and closed everything. The browse-side callers
  // (ContentCard, ContentDetailPanel) have nothing above tile content to clear.
  return (
    <div className="modal-overlay-in z-dialog fixed inset-0 flex items-center justify-center bg-black/65">
      <div className="modal-panel-in bg-canvas border-border-subtle w-full max-w-md rounded-xl border p-5">
        <h2 className="text-text-primary mb-1 text-sm font-semibold">Dependencies</h2>
        <p className="text-text-muted mb-4 text-xs">
          This mod requires the following. Required dependencies will be installed automatically.
        </p>

        {required.length > 0 && (
          <div className="mb-3">
            <div className="text-text-secondary mb-1 text-xs font-medium">Required</div>
            <div className="flex flex-col gap-1">
              {required.map((dep) => (
                <DepRow key={dep.projectId} dep={dep} checked locked={!dep.alreadyInstalled} />
              ))}
            </div>
          </div>
        )}

        {optional.length > 0 && (
          <div className="mb-4">
            <div className="text-text-secondary mb-1 text-xs font-medium">Optional</div>
            <div className="flex flex-col gap-1">
              {optional.map((dep) => (
                <DepRow
                  key={dep.projectId}
                  dep={dep}
                  checked={optionalSelected.has(dep.version.id)}
                  locked={false}
                  onChange={() => toggleOptional(dep.version.id)}
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="bg-surface text-text-secondary rounded px-3 py-1.5 text-xs"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="bg-accent text-canvas rounded px-3 py-1.5 text-xs font-medium"
          >
            Install
          </button>
        </div>
      </div>
    </div>
  )
}

function DepRow({
  dep,
  checked,
  locked,
  onChange,
}: {
  dep: ResolvedDependency
  checked: boolean
  locked: boolean
  onChange?: () => void
}) {
  return (
    <div
      className={`bg-surface flex items-center gap-2 rounded px-2 py-1.5 ${
        dep.alreadyInstalled ? 'opacity-50' : 'opacity-100'
      }`}
    >
      <input
        type="checkbox"
        checked={dep.alreadyInstalled ? true : checked}
        disabled={locked || dep.alreadyInstalled}
        onChange={onChange}
        className="accent-accent shrink-0"
      />
      <div className="min-w-0 flex-1">
        <span className="text-text-primary text-xs">{dep.projectTitle}</span>
        {dep.version.versionNumber && (
          <span className="text-text-muted ml-1 font-mono text-xs">
            {dep.version.versionNumber}
          </span>
        )}
      </div>
      {dep.alreadyInstalled && (
        <span className="text-text-muted shrink-0 rounded bg-white/[0.06] px-1 text-xs text-[10px]">
          installed
        </span>
      )}
    </div>
  )
}
