import { useEffect, useState } from 'react'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { useServerConfigStore } from '../stores/useServerConfigStore'
import { BrowseJarFile, BrowseDirectory, InspectServerFile } from '../../wailsjs/go/main/App'
import { ServerInstallModal } from './ServerInstallModal'
import type { InstallerDetails, InstallResult } from './ServerInstallModal'
import { ServerRow } from './ServerRow'
import { EVENTS } from '../lib/constants'
import type { ServerConfig } from '../types'

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

function parseRamFromArgs(args: string): { minRam: string; maxRam: string } {
  return {
    minRam: args.match(/-Xms(\S+)/)?.[1] ?? '',
    maxRam: args.match(/-Xmx(\S+)/)?.[1] ?? '',
  }
}

function mergeRamIntoArgs(args: string, minRam: string, maxRam: string): string {
  let result = args
  if (minRam) {
    result = /-Xms\S+/.test(result)
      ? result.replace(/-Xms\S+/, `-Xms${minRam}`)
      : `${result} -Xms${minRam}`.trim()
  }
  if (maxRam) {
    result = /-Xmx\S+/.test(result)
      ? result.replace(/-Xmx\S+/, `-Xmx${maxRam}`)
      : `${result} -Xmx${maxRam}`.trim()
  }
  return result
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

export function ServerSelector() {
  const { configs, activeId, loadConfigs, saveConfig, deleteConfig, setActiveId } =
    useServerConfigStore()
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [advancedMode, setAdvancedMode] = useState(false)
  const [pendingDisconnect, setPendingDisconnect] = useState<string | null>(null)
  const [installer, setInstaller] = useState<InstallerDetails | null>(null)
  // What a just-finished install told us, so Save records the right loader and
  // MC version instead of waiting for the first run to detect them.
  const [installed, setInstalled] = useState<InstallResult | null>(null)

  useEffect(() => {
    loadConfigs().catch(console.error)
  }, [loadConfigs])

  // Owned here rather than in the install modal so closing the modal mid-install
  // still yields a configured server when the installer finishes.
  useEffect(() => {
    let off: (() => void) | undefined
    try {
      off = EventsOn(
        EVENTS.INSTALL_FINISHED,
        (d?: { targetDir?: string; mcVersion?: string; loader?: string }) => {
          if (!d?.targetDir) return
          const result = {
            targetDir: d.targetDir,
            mcVersion: d.mcVersion ?? '',
            loader: d.loader ?? '',
          }
          setInstalled(result)
          setForm((f) => ({ ...f, jarPath: '', workingDir: result.targetDir }))
        },
      )
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

  const openNew = () => {
    setForm(emptyForm)
    setAdvancedMode(false)
    setEditing('new')
  }

  const openEdit = (cfg: ServerConfig) => {
    setForm(configToForm(cfg))
    setAdvancedMode(cfg.jvmArgs.some((a) => !a.startsWith('-Xms') && !a.startsWith('-Xmx')))
    setEditing(cfg.id)
  }

  const cancel = () => setEditing(null)

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

  // Shared by the Save button and the install modal's Add server, so the two
  // cannot drift. Returns null when the form is too incomplete to save.
  const buildConfig = (overrides: Partial<FormState> = {}): ServerConfig | null => {
    const merged = { ...form, ...overrides }
    const name = merged.name.trim()
    const jarPath = merged.jarPath.trim()
    const workingDir = merged.workingDir.trim()
    // A NeoForge/Forge install has no runnable jar — the working dir is what the
    // backend resolves the launch from, so only it and the name are required.
    if (!name || !workingDir) return null

    const id = editing === 'new' || editing === null ? crypto.randomUUID() : editing
    const finalArgs = advancedMode
      ? merged.jvmArgs
      : mergeRamIntoArgs(merged.jvmArgs, merged.minRam, merged.maxRam)
    const jvmArgs = finalArgs.trim() ? finalArgs.trim().split(/\s+/) : []

    const existing = configs.find((c) => c.id === id)
    // A fresh install knows exactly what it laid down; prefer that over both
    // the stored value and later log-based detection.
    const fromInstall = installed?.targetDir === workingDir ? installed : null
    return {
      id,
      name,
      jarPath,
      jvmArgs,
      workingDir,
      mcVersion: fromInstall?.mcVersion || (existing?.mcVersion ?? ''),
      loader: fromInstall?.loader || (existing?.loader ?? ''),
    }
  }

  const submit = async () => {
    const cfg = buildConfig()
    if (!cfg) return
    await saveConfig(cfg)
    setInstalled(null)
    setEditing(null)
  }

  // The install modal covers the sidebar, so it finishes the job itself rather
  // than pointing at a Save button the user cannot see behind it.
  const addInstalledServer = async () => {
    if (!installed) return
    const cfg = buildConfig({
      workingDir: installed.targetDir,
      jarPath: '',
      // An unnamed server would fail the guard silently; name it after the folder.
      name: form.name.trim() || baseOf(installed.targetDir),
    })
    if (!cfg) return
    await saveConfig(cfg)
    await setActiveId(cfg.id)
    setInstalled(null)
    setInstaller(null)
    setEditing(null)
  }

  const handleDisconnect = async (id: string) => {
    await deleteConfig(id)
    setPendingDisconnect(null)
  }

  const dirOf = (filePath: string) => {
    const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
    return idx >= 0 ? filePath.substring(0, idx) : ''
  }

  const baseOf = (filePath: string) => {
    const trimmed = filePath.replace(/[\\/]+$/, '')
    const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
    return idx >= 0 ? trimmed.substring(idx + 1) : trimmed
  }

  const isLaunchScript = (filePath: string) =>
    /[\\/]run\.(sh|bat|cmd)$/i.test(filePath) || /^run\.(sh|bat|cmd)$/i.test(filePath)

  const browseJar = async () => {
    const path = await BrowseJarFile().catch(() => '')
    if (!path) return

    // A Forge/NeoForge download is an installer, not a server — running it with
    // -jar would start the installer. Offer to install instead.
    const info = await InspectServerFile(path).catch(() => null)
    if (info?.isInstaller) {
      setInstaller({
        jarPath: path,
        loader: info.loader,
        version: info.version,
        mcVersion: info.mcVersion,
      })
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
    'flex-1 min-w-0 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder-white/25 outline-none focus:border-white/20 transition-colors font-mono'
  const plainInputClass =
    'w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder-white/25 outline-none focus:border-white/20 transition-colors font-mono'

  const field = (key: 'name', placeholder: string) => (
    <input
      type="text"
      value={form[key]}
      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      placeholder={placeholder}
      className={plainInputClass}
    />
  )

  const browseField = (
    key: 'jarPath' | 'workingDir',
    placeholder: string,
    onBrowse: () => void,
  ) => (
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
        className="shrink-0 rounded border border-white/10 px-2 py-1 font-mono text-xs text-white/40 transition-colors hover:border-white/25 hover:text-white"
        title="Browse"
      >
        …
      </button>
    </div>
  )

  const ramFields = (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <div className="flex flex-1 flex-col gap-1">
          <span className="px-0.5 text-xs text-white/30">Min RAM</span>
          <input
            type="text"
            value={form.minRam}
            onChange={(e) => setForm((f) => ({ ...f, minRam: e.target.value }))}
            placeholder="512M"
            className={plainInputClass}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <span className="px-0.5 text-xs text-white/30">Max RAM</span>
          <input
            type="text"
            value={form.maxRam}
            onChange={(e) => setForm((f) => ({ ...f, maxRam: e.target.value }))}
            placeholder="2G"
            className={plainInputClass}
          />
        </div>
      </div>
    </div>
  )

  const advancedField = (
    <input
      type="text"
      value={form.jvmArgs}
      onChange={(e) => setForm((f) => ({ ...f, jvmArgs: e.target.value }))}
      placeholder="-Xms512M -Xmx2G -XX:+UseG1GC"
      className={plainInputClass}
    />
  )

  return (
    <div className="flex flex-col gap-1 p-2">
      <div className="font-title mb-1 px-1 text-xs font-medium tracking-wider text-white/40 uppercase">
        Servers
      </div>

      {configs.map((cfg) => (
        <ServerRow
          key={cfg.id}
          cfg={cfg}
          active={cfg.id === activeId}
          onSelect={() => setActiveId(cfg.id)}
          onEdit={() => openEdit(cfg)}
          onDisconnect={() => setPendingDisconnect(cfg.id)}
        />
      ))}

      {editing !== null ? (
        <div className="border-border-subtle mt-1 flex flex-col gap-1.5 border-t-[0.5px] pt-2">
          {field('name', 'Name')}
          {browseField('jarPath', 'Server File', browseJar)}
          {browseField('workingDir', 'Working dir', browseDir)}
          {advancedMode ? advancedField : ramFields}
          <button
            onClick={toggleAdvanced}
            className="self-start text-xs text-white/25 transition-colors hover:text-white/50"
          >
            {advancedMode ? '← Simple' : '⚙ Advanced'}
          </button>
          <div className="mt-0.5 flex gap-1">
            <button
              onClick={submit}
              className="flex-1 rounded border border-white/10 py-1 text-xs text-white/60 transition-colors hover:border-white/25 hover:text-white"
            >
              Save
            </button>
            <button
              onClick={cancel}
              className="px-2 py-1 text-xs text-white/30 transition-colors hover:text-white/60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={openNew}
          className="mt-1 flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-white/30 transition-colors hover:bg-white/5 hover:text-white/60"
        >
          <span>+</span>
          <span>Add server</span>
        </button>
      )}

      {installer && (
        <ServerInstallModal
          installer={installer}
          suggestedDir={form.workingDir}
          onAddServer={addInstalledServer}
          onClose={() => setInstaller(null)}
        />
      )}

      {pendingDisconnect &&
        (() => {
          const name = configs.find((c) => c.id === pendingDisconnect)?.name ?? 'this server'
          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.6)]"
              onClick={() => setPendingDisconnect(null)}
            >
              <div
                className="bg-canvas border-border-subtle flex w-72 flex-col gap-4 rounded-xl border-[0.5px] p-5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-white">Disconnect server?</span>
                  <span className="text-xs text-white/50">
                    <span className="text-white/80">{name}</span> will be removed from Konnekt. Your
                    server files and data will not be affected.
                  </span>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setPendingDisconnect(null)}
                    className="rounded px-3 py-1.5 text-xs text-white/50 transition-colors hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleDisconnect(pendingDisconnect)}
                    className="rounded border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-500/20"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            </div>
          )
        })()}
    </div>
  )
}
