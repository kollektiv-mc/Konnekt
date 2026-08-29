import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../stores/useSettingsStore'
import type { AppSettings } from '../types'
import {
  ACCENT_PRESETS,
  SUCCESS_PRESETS,
  WARNING_PRESETS,
  DANGER_PRESETS,
  BUILTIN_SKINS,
} from '../lib/theme'
import type { SkinDefinition } from '../lib/theme'
import { Toggle } from './ui/Toggle'
import { Segmented } from './ui/Segmented'
import { ColorSwatch } from './ui/ColorSwatch'
import { SettingRow } from './ui/SettingRow'
import {
  OpenDataDir,
  GetAppVersion,
  GetDataDir,
  GetLogPath,
  CheckForUpdates,
  DownloadAndInstallUpdate,
} from '../../wailsjs/go/main/App'
import { BrowserOpenURL, EventsOn } from '../../wailsjs/runtime/runtime'
import type { models } from '../../wailsjs/go/models'
import { readOr } from '../lib/ipc'
import { CHANGELOG, CHANGELOG_URL, groupByDate } from '../lib/changelog'
import type { ChangelogEntry } from '../lib/changelog'
import { EVENTS } from '../lib/constants'
import { isDevBuild, isSnapshotVersion } from '../hooks/useUpdateCheck'

type UpdateFn = (patch: Partial<AppSettings>) => Promise<void>

type Section = 'appearance' | 'general' | 'console' | 'notifications' | 'changelog' | 'about'

const NAV: { id: Section; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'general', label: 'General' },
  { id: 'console', label: 'Console' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'changelog', label: "What's New" },
  { id: 'about', label: 'About' },
]

const THEME_OPTIONS = [
  { value: 'light' as const, label: '☀ Light' },
  { value: 'dark' as const, label: '◐ Dark' },
  { value: 'system' as const, label: '⊙ System' },
]

const UPDATE_CHANNEL_OPTIONS = [
  { value: 'stable' as const, label: 'Stable' },
  { value: 'snapshot' as const, label: 'Snapshot' },
]

const BG_STYLE_OPTIONS = [
  { value: 'solid' as const, label: 'Solid' },
  { value: 'gradient' as const, label: 'Gradient' },
]

interface Props {
  open: boolean
  onClose: () => void
}

export function SettingsModal({ open, onClose }: Props) {
  const { settings, error, update, clearError } = useSettingsStore()
  const [section, setSection] = useState<Section>('appearance')
  const overlayRef = useRef<HTMLDivElement>(null)
  // Fetched once here rather than in each pane: General needs it to say whether
  // this build already follows the snapshot channel, and About both displays it
  // and gates the install button on it. Null outside a Wails context.
  const [version, setVersion] = useState<string | null>(null)

  // Every control in every pane writes through this. The store has already put
  // the control back by the time the rejection lands, so there is nothing local
  // to revert — the swallow here just keeps a fire-and-forget `onChange` from
  // raising an unhandled rejection, and `error` says what happened.
  const save: UpdateFn = useCallback((patch) => update(patch).catch(() => {}), [update])

  // Gated on `open` because this component is mounted for the whole session
  // (it renders null when closed), and an unconditional effect here would turn
  // a Settings-only lookup into an extra IPC call at app startup.
  //
  // Through `readOr` rather than a bare `.catch()`: with no Wails bridge the
  // binding throws synchronously instead of rejecting, and the throw took the
  // whole app down the moment Settings opened in the `frontend-dev` preset.
  useEffect(() => {
    if (!open) return
    readOr(GetAppVersion, null).then(setVersion)
  }, [open])

  // A stale message from a previous visit would read as a failure of whatever
  // the user is about to touch.
  useEffect(() => {
    if (open) clearError()
  }, [open, clearError])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      className="modal-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.65)]"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose()
      }}
    >
      <div className="modal-panel-in bg-canvas border-border-subtle border-hairline flex h-[480px] w-[640px] overflow-hidden rounded-xl shadow-[0_24px_64px_rgba(0,0,0,0.5)]">
        {/* Left nav */}
        <div className="bg-surface border-border-subtle border-r-hairline flex w-40 shrink-0 flex-col gap-0.5 p-3">
          <div className="border-border-subtle border-b-hairline px-2 pt-1 pb-3">
            <span className="font-title text-text-muted text-xs font-semibold tracking-wider uppercase">
              Settings
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-0.5">
            {NAV.map((item) => (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={`rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                  section === item.id
                    ? 'text-accent bg-accent/10'
                    : 'text-text-secondary bg-transparent'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right content */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <div className="border-border-subtle border-b-hairline flex shrink-0 items-center justify-between px-5 py-3">
            <span className="text-text-primary text-sm font-semibold">
              {NAV.find((n) => n.id === section)?.label}
            </span>
            <button
              onClick={onClose}
              className="text-text-muted flex h-6 w-6 items-center justify-center rounded text-sm transition-colors"
            >
              ×
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="text-danger border-danger/20 bg-danger/10 border-b-hairline shrink-0 px-5 py-2 font-mono text-xs"
            >
              Couldn&apos;t save that setting: {error}
            </div>
          )}

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-2">
            {section === 'appearance' && <AppearancePane settings={settings} update={save} />}
            {section === 'general' && (
              <GeneralPane settings={settings} update={save} version={version} />
            )}
            {section === 'console' && <ConsolePane settings={settings} update={save} />}
            {section === 'notifications' && <NotificationsPane settings={settings} update={save} />}
            {section === 'changelog' && <ChangelogPane />}
            {section === 'about' && <AboutPane version={version} />}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Shared local components ──────────────────────────────────────────────────

function ColorField({
  value,
  onChange,
  presets,
}: {
  value: string
  onChange: (hex: string) => void
  presets: { label: string; hex: string }[]
}) {
  const isPreset = presets.some((p) => p.hex.toLowerCase() === value.toLowerCase())
  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((preset) => (
        <ColorSwatch
          key={preset.hex}
          hex={preset.hex}
          label={preset.label}
          selected={value.toLowerCase() === preset.hex.toLowerCase()}
          onClick={() => onChange(preset.hex)}
        />
      ))}
      <label
        className="border-border-hover border-thick relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-full border-dashed transition-transform hover:scale-110"
        // eslint-disable-next-line no-restricted-syntax -- value is an arbitrary runtime hex color, not a static token
        style={{
          background: isPreset ? 'var(--hover-surface)' : value,
          outline: !isPreset ? `2.5px solid ${value}` : '2.5px solid transparent',
          outlineOffset: 2,
        }}
        title="Custom color"
      >
        {isPreset && (
          <span className="text-text-muted absolute inset-0 flex items-center justify-center text-[10px]">
            +
          </span>
        )}
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute h-0 w-0 opacity-0"
        />
      </label>
    </div>
  )
}

function SkinCard({
  skin,
  selected,
  onClick,
}: {
  skin: SkinDefinition
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`border-thick flex w-21 shrink-0 flex-col gap-1.5 rounded-lg p-2 transition-colors ${
        selected ? 'border-accent bg-accent/8' : 'border-border-subtle bg-hover'
      }`}
    >
      <div className="flex h-[18px] gap-0.5 overflow-hidden rounded-sm">
        {skin.previewColors.map((color, i) => (
          // eslint-disable-next-line no-restricted-syntax -- color is a runtime hex from skin.previewColors, not a static token
          <div key={i} className="flex-1" style={{ background: color }} />
        ))}
      </div>
      <span
        className={`text-left text-[11px] leading-tight ${selected ? 'text-accent' : 'text-text-secondary'}`}
      >
        {skin.name}
      </span>
    </button>
  )
}

// ─── Appearance ───────────────────────────────────────────────────────────────

function AppearancePane({ settings, update }: { settings: AppSettings; update: UpdateFn }) {
  return (
    <div>
      {/* Skin gallery */}
      <div className="border-border-subtle border-b-hairline py-3">
        <span className="text-text-primary text-sm">Skin</span>
        <p className="text-text-muted mt-0.5 mb-3 text-xs">Built-in surface and border palette.</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {BUILTIN_SKINS.map((skin) => (
            <SkinCard
              key={skin.id}
              skin={skin}
              selected={settings.skinId === skin.id}
              onClick={() => update({ skinId: skin.id })}
            />
          ))}
        </div>
      </div>

      {/* Mode */}
      <SettingRow label="Mode" description="Light, dark, or follow your OS preference.">
        <Segmented
          options={THEME_OPTIONS}
          value={settings.theme}
          onChange={(theme) => update({ theme })}
        />
      </SettingRow>

      {/* Accent color */}
      <div className="border-border-subtle border-b-hairline py-3">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <span className="text-text-primary text-sm">Accent color</span>
            <p className="text-text-muted mt-0.5 text-xs">
              Highlights, active states, and status indicators.
            </p>
          </div>
          <div
            className="h-6 w-6 shrink-0 rounded-full [outline:1.5px_solid_var(--border-hover)] [outline-offset:2px]"
            // eslint-disable-next-line no-restricted-syntax -- settings.accentColor is a runtime user-chosen hex, not a static token
            style={{ background: settings.accentColor }}
          />
        </div>
        <ColorField
          value={settings.accentColor}
          onChange={(accentColor) => update({ accentColor })}
          presets={ACCENT_PRESETS}
        />
      </div>

      {/* Status colors */}
      <div className="border-border-subtle border-b-hairline py-3">
        <span className="text-text-primary text-sm">Status colors</span>
        <p className="text-text-muted mt-0.5 mb-3 text-xs">
          Used for success, warnings, and errors across the app.
        </p>
        <div className="flex flex-col gap-3">
          {(
            [
              { label: 'Success', key: 'successColor' as const, presets: SUCCESS_PRESETS },
              { label: 'Warning', key: 'warningColor' as const, presets: WARNING_PRESETS },
              { label: 'Error', key: 'dangerColor' as const, presets: DANGER_PRESETS },
            ] as const
          ).map(({ label, key, presets }) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <span className="text-text-secondary w-14 shrink-0 text-xs">{label}</span>
              <ColorField
                value={settings[key]}
                onChange={(hex) => update({ [key]: hex } as Partial<AppSettings>)}
                presets={presets}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Background style */}
      <SettingRow label="Background" description="Subtle accent glow behind the interface.">
        <Segmented
          options={BG_STYLE_OPTIONS}
          value={settings.backgroundStyle}
          onChange={(backgroundStyle) => update({ backgroundStyle })}
        />
      </SettingRow>

      {/* Import stub */}
      <div className="py-3">
        <div className="flex items-center gap-2">
          <span className="text-text-faint text-sm">Import custom skin…</span>
          <span className="bg-hover text-text-faint border-border-subtle border-hairline rounded px-1.5 py-0.5 text-[10px]">
            Coming soon
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── General ─────────────────────────────────────────────────────────────────

function GeneralPane({
  settings,
  update,
  version,
}: {
  settings: AppSettings
  update: UpdateFn
  version: string | null
}) {
  return (
    <div>
      <SettingRow
        label="Auto-start active server"
        description="Automatically start the selected server when Konnekt launches."
      >
        <Toggle
          checked={settings.autoStartActiveServer}
          onChange={(v) => update({ autoStartActiveServer: v })}
        />
      </SettingRow>
      <SettingRow
        label="Confirm before stopping"
        description="Show a confirmation dialog before stopping a running server."
      >
        <Toggle
          checked={settings.confirmBeforeStop}
          onChange={(v) => update({ confirmBeforeStop: v })}
        />
      </SettingRow>
      <SettingRow
        label="Stop grace period"
        description="How long a stop may wait for the server to shut down and save before Konnekt force kills it (seconds)."
      >
        <input
          type="number"
          min={5}
          max={600}
          step={5}
          value={settings.stopGraceSeconds}
          onChange={(e) =>
            update({ stopGraceSeconds: Math.min(600, Math.max(5, Number(e.target.value))) })
          }
          className="bg-hover border-border-subtle text-text-primary border-hairline w-20 rounded px-2 py-1 text-right text-xs outline-none"
        />
      </SettingRow>
      <SettingRow
        label="Check for updates on startup"
        description="Silently check for a new release when Konnekt launches and notify if one is found."
      >
        <Toggle
          checked={settings.checkUpdatesOnStartup}
          onChange={(v) => update({ checkUpdatesOnStartup: v })}
        />
      </SettingRow>
      <SettingRow
        label="Update channel"
        description={
          isSnapshotVersion(version ?? '')
            ? 'Snapshot builds are rebuilt from the newest code every night. They are untested and can be broken. This build is one, so it follows the snapshot channel until you install a release.'
            : 'Snapshot builds are rebuilt from the newest code every night. They are untested and can be broken.'
        }
      >
        {/* Deliberately shows the stored setting even on a snapshot build,
            where the service overrides it. Forcing the displayed value to
            "Snapshot" would misreport what is on disk and what happens once a
            release is installed. The description says so instead. */}
        <Segmented
          options={UPDATE_CHANNEL_OPTIONS}
          value={settings.updateChannel}
          onChange={(v) => update({ updateChannel: v })}
          compact
        />
      </SettingRow>
    </div>
  )
}

// ─── Console ─────────────────────────────────────────────────────────────────

function ConsolePane({ settings, update }: { settings: AppSettings; update: UpdateFn }) {
  return (
    <div>
      <SettingRow
        label="Show timestamps"
        description="Prefix each log line with the server timestamp."
      >
        <Toggle
          checked={settings.consoleTimestamps}
          onChange={(v) => update({ consoleTimestamps: v })}
        />
      </SettingRow>
      <SettingRow label="Buffer size" description="Maximum number of log lines kept in memory.">
        <input
          type="number"
          min={100}
          max={10000}
          step={100}
          value={settings.consoleBufferLines}
          onChange={(e) => update({ consoleBufferLines: Math.max(100, Number(e.target.value)) })}
          className="bg-hover border-border-subtle text-text-primary border-hairline w-20 rounded px-2 py-1 text-right text-xs outline-none"
        />
      </SettingRow>
    </div>
  )
}

// ─── Notifications ────────────────────────────────────────────────────────────

function NotificationsPane({ settings, update }: { settings: AppSettings; update: UpdateFn }) {
  return (
    <div>
      <SettingRow label="Crash alerts" description="Notify when the server stops unexpectedly.">
        <Toggle checked={settings.notifyOnCrash} onChange={(v) => update({ notifyOnCrash: v })} />
      </SettingRow>
      <SettingRow
        label="Player join/leave alerts"
        description="Notify when a player joins or leaves the server."
      >
        <Toggle checked={settings.notifyOnJoin} onChange={(v) => update({ notifyOnJoin: v })} />
      </SettingRow>
    </div>
  )
}

// ─── Changelog ────────────────────────────────────────────────────────────────

function ChangelogItem({ entry }: { entry: ChangelogEntry }) {
  const [showMinor, setShowMinor] = useState(false)
  const formattedDate = new Date(entry.date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  return (
    <div className="border-border-subtle border-b-hairline py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-4">
        <span className="text-text-primary text-sm">{entry.label}</span>
        <span className="text-text-muted shrink-0 text-xs">{formattedDate}</span>
      </div>
      <ul className="mt-1.5 flex flex-col gap-1">
        {entry.highlights.map((item, i) => (
          <li key={i} className="text-text-secondary flex gap-1.5 text-xs">
            <span className="text-text-faint">–</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
      {entry.minor && entry.minor.length > 0 && (
        <div className="mt-1.5">
          <button
            onClick={() => setShowMinor((v) => !v)}
            className="text-text-faint hover:text-text-muted text-[11px] transition-colors"
          >
            {showMinor ? '−' : '+'} {entry.minor.length} smaller change
            {entry.minor.length === 1 ? '' : 's'}
          </button>
          {showMinor && (
            <ul className="mt-1 flex flex-col gap-1">
              {entry.minor.map((item, i) => (
                <li key={i} className="text-text-muted flex gap-1.5 text-xs">
                  <span className="text-text-faint">–</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function ChangelogPane() {
  const [showEarlier, setShowEarlier] = useState(false)
  const grouped = groupByDate(CHANGELOG)
  const recent = grouped.slice(0, 3)
  const earlier = grouped.slice(3)

  const openChangelog = () => {
    try {
      BrowserOpenURL(CHANGELOG_URL)
    } catch {
      /* non-Wails context */
    }
  }

  return (
    <div className="flex flex-col py-2">
      <div className="flex flex-col">
        {recent.map((entry) => (
          <ChangelogItem key={entry.date} entry={entry} />
        ))}
      </div>

      {earlier.length > 0 && (
        <div className="border-border-subtle border-b-hairline py-2">
          <button
            onClick={() => setShowEarlier((v) => !v)}
            className="text-text-muted hover:text-text-secondary text-xs transition-colors"
          >
            {showEarlier ? '▾' : '▸'} Earlier updates
          </button>
          {showEarlier && (
            <div className="mt-1 flex flex-col">
              {earlier.map((entry) => (
                <ChangelogItem key={entry.date} entry={entry} />
              ))}
            </div>
          )}
        </div>
      )}

      <button
        onClick={openChangelog}
        className="text-accent border-accent/30 bg-accent/10 hover:bg-accent/15 border-hairline mt-3 rounded py-1.5 text-xs transition-colors"
      >
        View full changelog on GitHub ↗
      </button>
    </div>
  )
}

// ─── About ────────────────────────────────────────────────────────────────────

type UpdateCheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'upToDate' }
  | { status: 'available'; info: models.UpdateInfo }
  | { status: 'downloading'; info: models.UpdateInfo; percent: number }
  | { status: 'installFailed'; info: models.UpdateInfo; message: string }
  | { status: 'error' }

function AboutPane({ version }: { version: string | null }) {
  const [dataDir, setDataDir] = useState<string | null>(null)
  const [logPath, setLogPath] = useState<string | null>(null)
  const [checkState, setCheckState] = useState<UpdateCheckState>({ status: 'idle' })
  // Second click of the snapshot install confirm. Not folded into
  // UpdateCheckState: it is a property of the button, not of the check, and a
  // seventh variant would have to be threaded through every other branch.
  const [confirmSnapshot, setConfirmSnapshot] = useState(false)

  // Both paths come from the backend rather than being written out here: the
  // data-directory row used to hard-code "~/.config/konnekt", and the log is the
  // one thing worth attaching to a bug report, so show where it is rather than
  // making the user guess. Null outside a Wails context.
  useEffect(() => {
    readOr(GetDataDir, null).then(setDataDir)
    readOr(GetLogPath, null).then(setLogPath)
  }, [])

  // Streaming download progress, per CLAUDE.md's "no useEffect polling — use
  // a Wails event listener" rule. Only applied while actively downloading;
  // cleaned up on unmount so a closed Settings modal doesn't leak a listener.
  //
  // Guarded the way every other subscription in the app is: the runtime
  // helpers dereference `window.runtime` synchronously, so with no bridge
  // subscribing throws and would take this pane down with it.
  useEffect(() => {
    let off: (() => void) | undefined
    try {
      off = EventsOn(EVENTS.UPDATE_PROGRESS, (d?: { percent?: number }) => {
        setCheckState((prev) =>
          prev.status === 'downloading' ? { ...prev, percent: d?.percent ?? prev.percent } : prev,
        )
      })
    } catch {
      /* non-Wails context */
    }
    return () => {
      try {
        off?.()
      } catch {
        /* teardown no-op */
      }
    }
  }, [])

  const openFolder = () => {
    try {
      OpenDataDir().catch(() => {})
    } catch {
      /* non-Wails context */
    }
  }

  const openRelease = (url: string) => {
    try {
      BrowserOpenURL(url)
    } catch {
      /* non-Wails context */
    }
  }

  const runCheck = async () => {
    // A fresh check must not inherit a confirmation the user gave for a release
    // they are no longer being offered.
    setConfirmSnapshot(false)
    setCheckState({ status: 'checking' })
    try {
      const info = await CheckForUpdates()
      setCheckState(info.updateAvailable ? { status: 'available', info } : { status: 'upToDate' })
    } catch {
      setCheckState({ status: 'error' })
    }
  }

  const runInstall = async (info: models.UpdateInfo) => {
    setCheckState({ status: 'downloading', info, percent: 0 })
    try {
      // On success the app relaunches on the new version — this promise may
      // never resolve in this process. On failure (offline mid-download, a
      // permission-denied swap, a bad checksum) it rejects and we fall back
      // to the manual "open release page" path below.
      await DownloadAndInstallUpdate()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setCheckState({ status: 'installFailed', info, message })
    }
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex flex-col gap-1">
        <span className="text-text-primary text-sm font-semibold">Konnekt</span>
        <span className="text-text-muted text-xs">Minecraft Server Manager</span>
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-text-secondary flex items-center justify-between text-xs">
          <span>Version</span>
          <span className="text-text-muted font-mono text-[11px]">{version ?? '—'}</span>
        </div>
        <div className="text-text-secondary flex items-center justify-between text-xs">
          <span>License</span>
          <span className="text-text-muted">MIT</span>
        </div>
        <div className="text-text-secondary flex items-center justify-between text-xs">
          <span>Data directory</span>
          <button
            onClick={openFolder}
            className="text-text-muted font-mono text-[11px] transition-colors"
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'
            }}
            title={dataDir ? `Open ${dataDir}` : 'Open config folder'}
          >
            <span className="max-w-56 truncate">{dataDir ?? 'Open folder'}</span> ↗
          </button>
        </div>
        {logPath && (
          <div className="text-text-secondary flex items-center justify-between gap-3 text-xs">
            <span className="shrink-0">Log file</span>
            <span
              className="text-text-muted truncate font-mono text-[11px]"
              title={`${logPath} — attach this to a bug report`}
            >
              {logPath}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <button
          onClick={runCheck}
          disabled={checkState.status === 'checking' || checkState.status === 'downloading'}
          className="text-accent border-accent/30 bg-accent/10 hover:bg-accent/15 border-hairline rounded py-1.5 text-xs transition-colors disabled:opacity-50"
        >
          {checkState.status === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>

        {checkState.status === 'upToDate' && (
          <span className="text-text-muted text-center text-[11px]">You&apos;re up to date.</span>
        )}
        {checkState.status === 'error' && (
          <span className="text-danger text-center text-[11px]">
            Couldn&apos;t check for updates. Try again later.
          </span>
        )}
        {checkState.status === 'available' && (
          <div className="border-border-subtle border-hairline flex flex-col gap-1.5 rounded p-2.5">
            <span className="text-text-primary text-xs">
              {checkState.info.channel === 'snapshot' ? 'Snapshot available' : 'Update available'}:{' '}
              {checkState.info.latestVersion}
            </span>
            {checkState.info.channel === 'snapshot' && (
              <span className="bg-warning/[0.08] text-warning border-border-subtle border-hairline rounded px-2 py-1 text-[11px]">
                Rebuilt from the newest code and untested. It can be broken. Back up your server
                directory first.
              </span>
            )}
            {isDevBuild(version ?? '') ? (
              <span className="text-text-muted text-[11px]">
                Not available in dev builds — restart via a packaged build to install updates.
              </span>
            ) : checkState.info.channel === 'snapshot' ? (
              // Two steps on purpose. A misclick here swaps a working install
              // for untested nightly code, and the warning above is only worth
              // anything if something stops the click that follows it.
              !confirmSnapshot ? (
                <button
                  onClick={() => setConfirmSnapshot(true)}
                  className="text-warning border-warning/30 bg-warning/10 hover:bg-warning/15 border-hairline rounded py-1 text-[11px] transition-colors"
                >
                  Install snapshot…
                </button>
              ) : (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => runInstall(checkState.info)}
                    className="text-warning border-warning/30 bg-warning/10 hover:bg-warning/15 border-hairline flex-1 rounded py-1 text-[11px] transition-colors"
                  >
                    Install it anyway
                  </button>
                  <button
                    onClick={() => setConfirmSnapshot(false)}
                    className="text-text-muted hover:text-text-secondary border-border-subtle border-hairline rounded px-2 py-1 text-[11px] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )
            ) : (
              <button
                onClick={() => runInstall(checkState.info)}
                className="text-accent border-accent/30 bg-accent/10 hover:bg-accent/15 border-hairline rounded py-1 text-[11px] transition-colors"
              >
                Download &amp; Install
              </button>
            )}
            <button
              onClick={() => openRelease(checkState.info.releaseUrl)}
              className="text-text-muted hover:text-text-secondary text-[11px] transition-colors"
            >
              or open the release page ↗
            </button>
          </div>
        )}
        {checkState.status === 'downloading' && (
          <div className="border-border-subtle border-hairline flex flex-col gap-1.5 rounded p-2.5">
            <span className="text-text-primary text-xs">
              Downloading {checkState.info.latestVersion}… {checkState.percent}%
            </span>
            <div className="bg-hover h-1.5 overflow-hidden rounded-full">
              <div
                className="bg-accent h-full transition-all duration-300"
                // eslint-disable-next-line no-restricted-syntax -- width is a live download-progress percent
                style={{ width: `${checkState.percent}%` }}
              />
            </div>
            <span className="text-text-muted text-center text-[11px]">
              Konnekt will restart automatically once the download finishes.
            </span>
          </div>
        )}
        {checkState.status === 'installFailed' && (
          <div className="border-border-subtle border-hairline flex flex-col gap-1.5 rounded p-2.5">
            <span className="text-danger text-xs">Couldn&apos;t install automatically.</span>
            <span className="text-text-muted text-[11px]">{checkState.message}</span>
            <button
              onClick={() => openRelease(checkState.info.releaseUrl)}
              className="text-accent border-accent/30 bg-accent/10 hover:bg-accent/15 border-hairline rounded py-1 text-[11px] transition-colors"
            >
              Open release page ↗
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
