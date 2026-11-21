import { useState } from 'react'
import { BrowseDirectory } from '../../../wailsjs/go/main/App'
import { Segmented } from '../../components/ui/Segmented'
import { Tag } from '../../components/ui/Tag'
import { fmtDate } from '../../lib/format'
import { isRemoteBrowser } from '../../lib/ipc'
import type {
  ModSyncPlan,
  ModSyncRecord,
  ModSyncRow,
  PackSource,
  PackSourceInput,
  usePackSync,
} from './usePackSync'

// The mods tile's pack section (#454, #456): which pack the server follows,
// what syncing it would do, and the syncs that can be rolled back.

type Sync = ReturnType<typeof usePackSync>

const BUTTON =
  'text-text-secondary border-border-subtle border-hairline hover:bg-hover shrink-0 rounded bg-transparent px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50'
const PRIMARY =
  'bg-accent text-canvas shrink-0 rounded px-3 py-1 text-xs font-semibold transition-opacity hover:opacity-85 disabled:opacity-50'
const INPUT =
  'text-text-primary caret-accent border-border-subtle border-hairline focus:border-accent min-w-0 flex-1 rounded bg-transparent px-2 py-1 font-mono text-xs outline-none'

const ACTION_TONE: Record<string, 'muted' | 'accent' | 'warning' | 'danger'> = {
  add: 'accent',
  update: 'accent',
  remove: 'warning',
  disable: 'warning',
  blocked: 'danger',
}

/** Rows that change a file come first, then the ones that leave it be. */
const CHANGES = new Set(['blocked', 'add', 'update', 'remove', 'disable'])

export function PackPanel({ sync }: { sync: Sync }) {
  const [editing, setEditing] = useState(false)

  if (sync.loading) {
    return <p className="text-text-muted p-3 text-xs">Loading…</p>
  }
  if (!sync.source || editing) {
    return (
      <SourceForm
        initial={sync.source}
        busy={sync.busy === 'save'}
        error={sync.error}
        onCancel={sync.source ? () => setEditing(false) : undefined}
        onSave={async (input) => {
          await sync.saveSource(input)
          setEditing(false)
        }}
      />
    )
  }
  return <PackView sync={sync} source={sync.source} onEdit={() => setEditing(true)} />
}

function SourceForm({
  initial,
  busy,
  error,
  onSave,
  onCancel,
}: {
  initial: PackSource | null
  busy: boolean
  error: string | null
  onSave: (input: PackSourceInput) => Promise<void>
  onCancel?: () => void
}) {
  const [location, setLocation] = useState<'url' | 'folder'>(
    initial?.location === 'folder' ? 'folder' : 'url',
  )
  const [address, setAddress] = useState(initial?.address ?? '')

  async function browse() {
    const dir = await BrowseDirectory().catch(() => '')
    if (dir) setAddress(dir)
  }

  async function submit() {
    try {
      await onSave({
        location,
        address: address.trim(),
        exclude: initial?.exclude ?? [],
        include: initial?.include ?? [],
      })
    } catch {
      // The hook recorded the message, shown below; the form stays open to fix it.
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <span className="text-text-secondary text-xs font-semibold">Pack source</span>
      <div className="self-start">
        <Segmented
          compact
          options={[
            { value: 'url', label: 'URL' },
            { value: 'folder', label: 'Folder' },
          ]}
          value={location}
          onChange={setLocation}
        />
      </div>
      <div className="flex gap-2">
        <input
          aria-label={location === 'url' ? 'Address of pack.toml' : 'Folder holding pack.toml'}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder={location === 'url' ? 'https://…/pack.toml' : '/path/to/pack'}
          className={INPUT}
        />
        {location === 'folder' && !isRemoteBrowser() && (
          <button onClick={browse} className={BUTTON}>
            Browse
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button onClick={onCancel} className={BUTTON}>
            Cancel
          </button>
        )}
        <button onClick={submit} disabled={busy || !address.trim()} className={PRIMARY}>
          Save
        </button>
      </div>
    </div>
  )
}

function PackView({
  sync,
  source,
  onEdit,
}: {
  sync: Sync
  source: PackSource
  onEdit: () => void
}) {
  const plan = sync.plan
  const canRollBack = sync.history.some((r) => !r.rolledBack)
  const canApply =
    !!plan && plan.blockers.length === 0 && (!plan.upToDate || plan.adopted > 0) && !sync.busy

  // A list change drops the plan, so it is made again to show the effect.
  async function setLists(exclude: string[], include: string[]) {
    try {
      await sync.saveSource({
        location: source.location === 'folder' ? 'folder' : 'url',
        address: source.address,
        exclude,
        include,
      })
      await sync.check()
    } catch {
      // Recorded by the hook and shown in the panel.
    }
  }

  async function act(call: () => Promise<void>) {
    try {
      await call()
    } catch {
      // Recorded by the hook and shown in the panel.
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border-subtle border-b-hairline flex shrink-0 items-center gap-2 px-3 py-2">
        <span className="text-text-muted min-w-0 flex-1 truncate font-mono text-xs">
          {source.address}
        </span>
        <button onClick={onEdit} className={BUTTON}>
          Change
        </button>
        <button onClick={() => act(sync.clearSource)} disabled={!!sync.busy} className={BUTTON}>
          Unbind
        </button>
      </div>
      <div className="border-border-subtle border-b-hairline flex shrink-0 items-center gap-2 px-3 py-2">
        <span className="text-text-secondary min-w-0 flex-1 truncate text-xs">
          {plan ? `${plan.packName} ${plan.packVersion}` : lastApplied(sync.history)}
        </span>
        {canRollBack && (
          <button onClick={() => act(sync.rollback)} disabled={!!sync.busy} className={BUTTON}>
            {sync.busy === 'rollback' ? 'Rolling back…' : 'Roll back'}
          </button>
        )}
        <button onClick={() => act(sync.check)} disabled={!!sync.busy} className={BUTTON}>
          {sync.busy === 'plan' ? 'Checking…' : 'Check'}
        </button>
        <button onClick={() => act(sync.apply)} disabled={!canApply} className={PRIMARY}>
          {sync.busy === 'apply' ? 'Applying…' : 'Apply'}
        </button>
      </div>
      {sync.error && (
        <p
          role="alert"
          className="text-danger border-border-subtle border-b-hairline shrink-0 px-3 py-1.5 text-xs"
        >
          {sync.error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {plan ? (
          <PlanView
            plan={plan}
            source={source}
            disabled={!!sync.busy}
            onLists={(exclude, include) => setLists(exclude, include)}
          />
        ) : (
          <History records={sync.history} />
        )}
      </div>
    </div>
  )
}

function lastApplied(history: ModSyncRecord[]): string {
  const last = history.find((r) => !r.rolledBack)
  return last ? `${last.packName} ${last.packVersion}` : 'Not synced yet'
}

function PlanView({
  plan,
  source,
  disabled,
  onLists,
}: {
  plan: ModSyncPlan
  source: PackSource
  disabled: boolean
  onLists: (exclude: string[], include: string[]) => void
}) {
  const rows = [...plan.rows].sort(
    (a, b) => Number(CHANGES.has(b.action)) - Number(CHANGES.has(a.action)),
  )
  const exclude = source.exclude ?? []
  const include = source.include ?? []

  function toggle(row: ModSyncRow) {
    if (exclude.includes(row.key)) {
      onLists(
        exclude.filter((k) => k !== row.key),
        include,
      )
    } else if (include.includes(row.key)) {
      onLists(
        exclude,
        include.filter((k) => k !== row.key),
      )
    } else if (row.side === 'client' && (row.action === 'skip' || row.action === 'disable')) {
      onLists(exclude, [...include, row.key])
    } else {
      onLists([...exclude, row.key], include)
    }
  }

  function toggleLabel(row: ModSyncRow): string | null {
    if (exclude.includes(row.key) || include.includes(row.key)) return 'Reset'
    if (row.action === 'remove' || row.action === 'blocked') return null
    if (row.action === 'skip' || row.action === 'disable') {
      return row.side === 'client' ? 'Install here' : null
    }
    return 'Exclude'
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <p className="text-text-muted text-xs">
        {plan.upToDate
          ? 'Up to date.'
          : `${plan.added} to add, ${plan.updated} to update, ${plan.removed} to remove, ${plan.disabled} to disable.`}{' '}
        {plan.kept + plan.adopted} kept, {plan.skipped} skipped.
      </p>
      {plan.blockers.map((b) => (
        <p key={b} role="alert" className="text-danger text-xs">
          {b}
        </p>
      ))}
      {plan.warnings.map((w) => (
        <p key={w} className="text-warning text-xs">
          {w}
        </p>
      ))}
      <ul className="flex flex-col">
        {rows.map((row) => {
          const label = row.key ? toggleLabel(row) : null
          return (
            <li
              key={row.action + row.fileName}
              className="border-border-subtle border-b-hairline group flex items-center gap-2 py-1.5"
            >
              <Tag
                tone={ACTION_TONE[row.action] ?? 'muted'}
                className="w-16 shrink-0 justify-center"
              >
                {row.action}
              </Tag>
              <div className="min-w-0 flex-1">
                <p className="text-text-primary truncate font-mono text-xs">
                  {row.from ? `${row.from} → ${row.fileName}` : row.fileName}
                </p>
                <p className="text-text-muted truncate text-xs">{row.note || row.reason}</p>
              </div>
              {label && (
                <button
                  onClick={() => toggle(row)}
                  disabled={disabled}
                  className={`${BUTTON} opacity-0 group-hover:opacity-100 focus:opacity-100`}
                >
                  {label}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function History({ records }: { records: ModSyncRecord[] }) {
  if (records.length === 0) {
    return (
      <p className="text-text-muted p-3 text-xs">Check the pack to see what a sync would do.</p>
    )
  }
  return (
    <ul className="flex flex-col p-3">
      {records.map((r) => (
        <li
          key={r.id}
          className="border-border-subtle border-b-hairline flex items-center gap-2 py-1.5 text-xs"
        >
          <span className="text-text-primary min-w-0 flex-1 truncate">
            {r.packName} {r.packVersion}
          </span>
          <span className="text-text-muted shrink-0">
            +{r.added} ~{r.updated} -{r.removed}
          </span>
          <span className="text-text-muted shrink-0">{fmtDate(r.appliedAt)}</span>
          {r.rolledBack && <Tag>rolled back</Tag>}
        </li>
      ))}
    </ul>
  )
}
