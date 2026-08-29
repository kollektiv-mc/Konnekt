import { useEffect, useState } from 'react'
import { BrowseJarFile, BrowseDirectory, InspectServerFile } from '../../../wailsjs/go/main/App'
import { useInstallStore } from '../../stores/useInstallStore'
import { useServerConfigStore } from '../../stores/useServerConfigStore'
import {
  baseOf,
  dirOf,
  isLaunchScript,
  mergeRamIntoArgs,
  parseRamFromArgs,
} from '../../lib/serverForm'
import type { InstallResult } from '../ServerInstallModal'
import type { ServerConfig } from '../../types'

interface FormState {
  name: string
  jarPath: string
  workingDir: string
  jvmArgs: string // canonical full expression, always kept in sync
  minRam: string
  maxRam: string
}

const emptyForm: FormState = {
  name: '',
  jarPath: '',
  workingDir: '',
  jvmArgs: '-Xms512M -Xmx2G',
  minRam: '512M',
  maxRam: '2G',
}

function configToForm(cfg: ServerConfig): FormState {
  const jvmArgs = cfg.jvmArgs.join(' ')
  const { minRam, maxRam } = parseRamFromArgs(jvmArgs)
  return {
    name: cfg.name,
    jarPath: cfg.jarPath,
    workingDir: cfg.workingDir,
    jvmArgs,
    minRam,
    maxRam,
  }
}

interface Props {
  /** The server being edited, or null to add a new one. */
  config: ServerConfig | null
  /** A just-finished install, whose values outrank both the form and the store. */
  installed: InstallResult | null
  onSaved: (cfg: ServerConfig) => void
  onCancel?: () => void
  /** Label for the primary button; the install flow calls it "Add server". */
  submitLabel?: string
}

/**
 * The one server editor.
 *
 * This logic used to live inline in `ServerSelector`, in a 12rem sidebar that
 * could not give it room. It moved here whole rather than being rewritten, so
 * the behaviours worth keeping came with it — in particular that a refused save
 * leaves the editor open (see `submit`), and that picking an installer jar
 * raises rather than saves.
 */
export function ServerEditForm({
  config,
  installed,
  onSaved,
  onCancel,
  submitLabel = 'Save',
}: Props) {
  const saveConfig = useServerConfigStore((s) => s.saveConfig)
  const openInstaller = useInstallStore((s) => s.openFor)
  const [form, setForm] = useState<FormState>(config ? configToForm(config) : emptyForm)
  const [advancedMode, setAdvancedMode] = useState(
    config ? config.jvmArgs.some((a) => !a.startsWith('-Xms') && !a.startsWith('-Xmx')) : false,
  )

  // Re-seed when the selection changes, so switching servers in the list does
  // not leave the previous server's values in the fields.
  useEffect(() => {
    setForm(config ? configToForm(config) : emptyForm)
    setAdvancedMode(
      config ? config.jvmArgs.some((a) => !a.startsWith('-Xms') && !a.startsWith('-Xmx')) : false,
    )
  }, [config])

  // A finished install knows where it put the server; the jar path is cleared
  // because a modern NeoForge/Forge install has no runnable jar.
  useEffect(() => {
    if (!installed) return
    setForm((f) => ({ ...f, jarPath: '', workingDir: installed.targetDir }))
  }, [installed])

  const toggleAdvanced = () => {
    if (!advancedMode) {
      // simple → advanced: merge current min/max into the expression first
      setForm((f) => ({ ...f, jvmArgs: mergeRamIntoArgs(f.jvmArgs, f.minRam, f.maxRam) }))
    } else {
      // advanced → simple: parse min/max out of the raw expression
      setForm((f) => ({ ...f, ...parseRamFromArgs(f.jvmArgs) }))
    }
    setAdvancedMode((v) => !v)
  }

  // Returns null when the form is too incomplete to save.
  const buildConfig = (overrides: Partial<FormState> = {}): ServerConfig | null => {
    const merged = { ...form, ...overrides }
    const name = merged.name.trim()
    const jarPath = merged.jarPath.trim()
    const workingDir = merged.workingDir.trim()
    // A NeoForge/Forge install has no runnable jar — the working dir is what the
    // backend resolves the launch from, so only it and the name are required.
    if (!name || !workingDir) return null

    const finalArgs = advancedMode
      ? merged.jvmArgs
      : mergeRamIntoArgs(merged.jvmArgs, merged.minRam, merged.maxRam)
    const jvmArgs = finalArgs.trim() ? finalArgs.trim().split(/\s+/) : []

    // A fresh install knows exactly what it laid down; prefer that over both
    // the stored value and later log-based detection.
    const fromInstall = installed?.targetDir === workingDir ? installed : null
    return {
      id: config?.id ?? crypto.randomUUID(),
      name,
      jarPath,
      jvmArgs,
      workingDir,
      mcVersion: fromInstall?.mcVersion || (config?.mcVersion ?? ''),
      loader: fromInstall?.loader || (config?.loader ?? ''),
      loaderVersion: fromInstall?.loaderVersion || (config?.loaderVersion ?? ''),
    }
  }

  // A refused write leaves the editor open with the store's message under it.
  // Closing it would show the edit as saved and lose it: the form holds the
  // working directory and the JVM args, and nothing else in the app carries a
  // copy.
  const submit = async () => {
    const cfg = buildConfig({
      // An unnamed install would fail the guard silently; name it after the folder.
      name: form.name.trim() || (installed ? baseOf(installed.targetDir) : ''),
    })
    if (!cfg) return
    try {
      await saveConfig(cfg)
    } catch {
      return
    }
    onSaved(cfg)
  }

  const browseJar = async () => {
    const path = await BrowseJarFile().catch(() => '')
    if (!path) return

    // A Forge/NeoForge download is an installer, not a server — running it with
    // -jar would start the installer. Offer to install instead.
    const info = await InspectServerFile(path).catch(() => null)
    if (info?.isInstaller) {
      openInstaller(
        {
          jarPath: path,
          loader: info.loader,
          version: info.version,
          mcVersion: info.mcVersion,
        },
        form.workingDir,
      )
      return
    }

    // Picking run.sh/run.bat only tells us where the install is — the backend
    // resolves the launch from the directory, so leave the jar path empty.
    setForm((f) => ({
      ...f,
      jarPath: isLaunchScript(path) ? '' : path,
      workingDir: dirOf(path),
    }))
  }

  const browseDir = async () => {
    const path = await BrowseDirectory().catch(() => '')
    if (path) setForm((f) => ({ ...f, workingDir: path }))
  }

  const inputClass =
    'bg-surface border-border-subtle text-text-primary placeholder-text-faint focus:border-border-hover border-hairline w-full min-w-0 rounded px-2 py-1.5 font-mono text-xs transition-colors outline-none'

  const labelled = (label: string, children: React.ReactNode) => (
    <label className="flex flex-col gap-1">
      <span className="text-text-faint text-2xs px-0.5 tracking-wider uppercase">{label}</span>
      {children}
    </label>
  )

  const browseField = (
    key: 'jarPath' | 'workingDir',
    label: string,
    placeholder: string,
    onBrowse: () => void,
  ) =>
    labelled(
      label,
      <div className="flex gap-1">
        <input
          type="text"
          value={form[key]}
          onChange={(e) => {
            const val = e.target.value
            if (key === 'jarPath') {
              setForm((f) => ({ ...f, jarPath: val, workingDir: f.workingDir || dirOf(val) }))
            } else {
              setForm((f) => ({ ...f, [key]: val }))
            }
          }}
          placeholder={placeholder}
          className={inputClass}
        />
        <button
          type="button"
          onClick={onBrowse}
          className="border-border-subtle text-text-muted hover:border-border-hover hover:text-text-primary border-hairline shrink-0 rounded px-2.5 py-1 font-mono text-xs transition-colors"
          title="Browse"
        >
          …
        </button>
      </div>,
    )

  return (
    <div className="flex flex-col gap-3">
      {labelled(
        'Name',
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="My server"
          className={inputClass}
        />,
      )}

      {browseField('jarPath', 'Server file', 'server.jar or run.sh', browseJar)}
      {browseField('workingDir', 'Working directory', 'Install folder', browseDir)}

      {advancedMode ? (
        labelled(
          'JVM arguments',
          <input
            type="text"
            value={form.jvmArgs}
            onChange={(e) => setForm((f) => ({ ...f, jvmArgs: e.target.value }))}
            placeholder="-Xms512M -Xmx2G -XX:+UseG1GC"
            className={inputClass}
          />,
        )
      ) : (
        <div className="flex gap-2">
          <div className="flex-1">
            {labelled(
              'Min RAM',
              <input
                type="text"
                value={form.minRam}
                onChange={(e) => setForm((f) => ({ ...f, minRam: e.target.value }))}
                placeholder="512M"
                className={inputClass}
              />,
            )}
          </div>
          <div className="flex-1">
            {labelled(
              'Max RAM',
              <input
                type="text"
                value={form.maxRam}
                onChange={(e) => setForm((f) => ({ ...f, maxRam: e.target.value }))}
                placeholder="2G"
                className={inputClass}
              />,
            )}
          </div>
        </div>
      )}

      <button
        onClick={toggleAdvanced}
        className="text-text-faint hover:text-text-secondary self-start text-xs transition-colors"
      >
        {advancedMode ? '← Simple' : '⚙ Advanced'}
      </button>

      <div className="flex gap-2 pt-1">
        <button
          onClick={submit}
          className="text-accent border-accent/30 hover:bg-accent/10 border-hairline flex-1 rounded py-1.5 text-xs transition-colors"
        >
          {submitLabel}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="text-text-faint hover:text-text-secondary px-3 py-1.5 text-xs transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
