import { useEffect, useRef, useState } from 'react'
import { EventsOn } from '../wailsjs/runtime/runtime'
import { StartServer } from '../wailsjs/go/main/App'
import { Dashboard } from './components/Dashboard'
import { TileCrate } from './components/TileCrate'
import { LayoutPresets } from './components/LayoutPresets'
import { ActiveProcesses } from './components/ActiveProcesses'
import { ServerSelector } from './components/ServerSelector'
import { ServerManager, NEW_SERVER } from './components/ServerManager'
import { ServerInstallModal } from './components/ServerInstallModal'
import { LoaderUpdateDialog } from './components/ServerManager/LoaderUpdateDialog'
import { DisconnectConfirm } from './components/DisconnectConfirm'
import { EulaModal } from './components/EulaModal'
import { SettingsModal } from './components/SettingsModal'
import { useInstallStore } from './stores/useInstallStore'
import { useLoaderStore } from './stores/useLoaderStore'
import { useUiStore } from './stores/useUiStore'
import { useServerConfigStore } from './stores/useServerConfigStore'
import { useConsoleStore } from './stores/useConsoleStore'
import { useSettingsStore } from './stores/useSettingsStore'
import { useProcessesStore } from './stores/useProcessesStore'
import { emitNotification } from './lib/notify'
import { prefetchHeavyChunks } from './lib/prefetch'
import { useUpdateCheck } from './hooks/useUpdateCheck'
import { useServerStatusSync } from './hooks/useServerStatus'
import { useNavWidth } from './hooks/useNavWidth'
import { IconButton } from './components/ui/IconButton'
import { Settings } from './lib/icons'
import { Icon } from './components/ui/Icon'
import { EVENTS } from './lib/constants'

function App() {
  const { activeId } = useServerConfigStore()
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const checkUpdatesOnStartup = useSettingsStore((s) => s.settings.checkUpdatesOnStartup)
  const installOpen = useInstallStore((s) => s.open)
  const loaderDialogOpen = useLoaderStore((s) => s.dialogOpen)
  const [eulaRequired, setEulaRequired] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { width: navWidth, resizing, onHandleMouseDown, onHandleDoubleClick } = useNavWidth()
  // Any drag that moves the navbar or something inside it. While one is in
  // flight nothing in there should light up under the pointer: the row being
  // reordered has its own accent outline to keep, and a resize drags the
  // pointer straight across every row on its way. Suppressing at the container
  // rather than per-rule because it is the same answer for all of them, and
  // because a `hover:` variant outranks whatever base class it is fighting.
  // The gestures themselves are on window listeners and read rects, so nothing
  // here depends on the navbar being hit-testable mid-drag.
  const crateDragging = useUiStore((s) => s.crateDragId !== null || s.draggingTileId !== null)
  const navFrozen = resizing || crateDragging
  const autoStarted = useRef(false)
  const lowTpsWarned = useRef(false)

  useEffect(() => {
    useSettingsStore.getState().load()
  }, [])

  // Warm the heavy lazy-loaded tile chunks (worlds scene, charts) during
  // idle time so the first tile open doesn't stutter on a cold fetch+eval.
  useEffect(() => {
    prefetchHeavyChunks()
  }, [])

  useUpdateCheck(settingsLoaded && checkUpdatesOnStartup)

  // Mounted here, not in the stats tile: six components read the resulting
  // status and tiles are removable, so tying it to one tile left the rest
  // reading a stale offline default (see the hook's own comment).
  useServerStatusSync(activeId)

  // Auto-start active server on launch
  useEffect(() => {
    if (!settingsLoaded || !activeId || autoStarted.current) return
    if (useSettingsStore.getState().settings.autoStartActiveServer) {
      autoStarted.current = true
      StartServer(activeId).catch(() => {
        /* already running or no server */
      })
    }
  }, [settingsLoaded, activeId])

  useEffect(() => {
    let cleanup: (() => void) | undefined
    try {
      cleanup = EventsOn(EVENTS.EULA_REQUIRED, () => setEulaRequired(true))
    } catch {
      /* non-Wails context */
    }
    return () => {
      try {
        cleanup?.()
      } catch {
        /* teardown no-op */
      }
    }
  }, [])

  // Batch log lines so the console re-renders at most ~7×/sec instead of once
  // per line — prevents render storms on busy servers.
  const pendingLines = useRef<Array<{ timestamp: string; line: string; source?: string }>>([])
  useEffect(() => {
    let cleanup: (() => void) | undefined
    try {
      cleanup = EventsOn(
        EVENTS.LOG_LINE,
        // `source` marks a line Konnekt narrated rather than server output
        // (#113); it is absent on server lines.
        (data: { timestamp: string; line: string; source?: string }) => {
          pendingLines.current.push(data)
        },
      )
    } catch {
      /* non-Wails context */
    }
    return () => {
      try {
        cleanup?.()
      } catch {
        /* teardown no-op */
      }
    }
  }, [])
  useEffect(() => {
    const id = setInterval(() => {
      const batch = pendingLines.current
      if (batch.length === 0) return
      pendingLines.current = []
      useConsoleStore.getState().batchAppend(batch)
    }, 150)
    return () => clearInterval(id)
  }, [])

  // Server stopped — detect crash vs. deliberate stop
  useEffect(() => {
    let cleanup: (() => void) | undefined
    try {
      cleanup = EventsOn(
        EVENTS.SERVER_STOPPED,
        (payload?: { expected?: boolean; exitCode?: number }) => {
          const { settings } = useSettingsStore.getState()
          if (!payload?.expected && settings.notifyOnCrash) {
            const code = payload?.exitCode
            const detail =
              typeof code !== 'number'
                ? ''
                : code === -1
                  ? ' (killed by a signal)'
                  : ` (exit code ${code})`
            emitNotification('crash', `Server stopped unexpectedly${detail}`)
          }
        },
      )
    } catch {
      /* non-Wails context */
    }
    return () => {
      try {
        cleanup?.()
      } catch {
        /* teardown no-op */
      }
    }
  }, [])

  // Player join notifications
  useEffect(() => {
    let cleanup: (() => void) | undefined
    try {
      // server.go emits {name, ip} — not a bare string.
      cleanup = EventsOn(EVENTS.PLAYER_JOINED, (d?: { name?: string }) => {
        if (!d?.name) return
        const { settings } = useSettingsStore.getState()
        if (settings.notifyOnJoin) {
          emitNotification('join', `${d.name} joined the game`)
        }
      })
    } catch {
      /* non-Wails context */
    }
    return () => {
      try {
        cleanup?.()
      } catch {
        /* teardown no-op */
      }
    }
  }, [])

  // Backup / restore notifications + sidebar progress tracking
  useEffect(() => {
    let c1: (() => void) | undefined
    let c2: (() => void) | undefined
    let c3: (() => void) | undefined
    let c4: (() => void) | undefined
    let c5: (() => void) | undefined
    try {
      c1 = EventsOn(EVENTS.BACKUP_STARTED, (data?: { serverID?: string; filename?: string }) => {
        useProcessesStore.getState().start(data?.serverID ?? 'backup', 'Backing up world…', {
          filename: data?.filename,
          view: { kind: 'tile', tileId: 'backups' },
        })
      })
      c2 = EventsOn(EVENTS.BACKUP_PROGRESS, (data?: { serverID?: string; percent?: number }) => {
        useProcessesStore.getState().updateProgress(data?.serverID ?? 'backup', data?.percent ?? 0)
      })
      c3 = EventsOn(EVENTS.BACKUP_COMPLETED, (data?: { serverID?: string }) => {
        useProcessesStore.getState().finish(data?.serverID ?? 'backup', 'done')
        emitNotification('info', 'Backup completed')
      })
      c4 = EventsOn(EVENTS.RESTORE_COMPLETED, () => {
        emitNotification('info', 'Restore completed')
      })
      c5 = EventsOn(EVENTS.BACKUP_FAILED, (data?: { serverID?: string; error?: string }) => {
        useProcessesStore.getState().finish(data?.serverID ?? 'backup', 'failed')
        emitNotification('crash', `Backup failed${data?.error ? ': ' + data.error : ''}`)
      })
    } catch {
      /* non-Wails context */
    }
    return () => {
      try {
        c1?.()
      } catch {
        /* teardown no-op */
      }
      try {
        c2?.()
      } catch {
        /* teardown no-op */
      }
      try {
        c3?.()
      } catch {
        /* teardown no-op */
      }
      try {
        c4?.()
      } catch {
        /* teardown no-op */
      }
      try {
        c5?.()
      } catch {
        /* teardown no-op */
      }
    }
  }, [])

  // Mod install progress → sidebar ActiveProcesses + tile top bar
  useEffect(() => {
    let c1: (() => void) | undefined
    let c2: (() => void) | undefined
    let c3: (() => void) | undefined
    try {
      c1 = EventsOn(
        EVENTS.MOD_INSTALL_PROGRESS,
        (d?: { serverID?: string; fileName?: string; percent?: number }) => {
          const key = 'mod:' + (d?.serverID ?? '')
          const store = useProcessesStore.getState()
          if (!store.processes[key]) {
            store.start(key, `Downloading ${d?.fileName ?? 'mod'}…`, {
              view: { kind: 'tile', tileId: 'mods' },
            })
          }
          store.updateProgress(key, d?.percent ?? 0)
        },
      )
      c2 = EventsOn(EVENTS.MOD_INSTALLED, (d?: { serverID?: string }) => {
        useProcessesStore.getState().finish('mod:' + (d?.serverID ?? ''), 'done')
      })
      c3 = EventsOn(EVENTS.MOD_INSTALL_FAILED, (d?: { serverID?: string }) => {
        useProcessesStore.getState().finish('mod:' + (d?.serverID ?? ''), 'failed')
      })
    } catch {
      /* non-Wails context */
    }
    return () => {
      try {
        c1?.()
      } catch {
        /* teardown no-op */
      }
      try {
        c2?.()
      } catch {
        /* teardown no-op */
      }
      try {
        c3?.()
      } catch {
        /* teardown no-op */
      }
    }
  }, [])

  // Server installer → the install modal's state, the sidebar row, and the
  // add-server form. All of it lives here rather than in the modal because the
  // modal can be dismissed mid-install and the work carries on.
  useEffect(() => {
    const offs: Array<() => void> = []
    const key = (dir?: string) => 'install:' + (dir ?? '')
    let current = key()
    try {
      offs.push(
        EventsOn(EVENTS.INSTALL_STARTED, (d?: { targetDir?: string }) => {
          current = key(d?.targetDir)
          // The installer reports log lines, never a percentage — mark it
          // indeterminate rather than showing a number we'd be inventing.
          useProcessesStore.getState().start(current, 'Installing server…', {
            indeterminate: true,
            view: { kind: 'install' },
          })
        }),
      )
      offs.push(
        EventsOn(
          EVENTS.INSTALL_FINISHED,
          (d?: {
            targetDir?: string
            mcVersion?: string
            loader?: string
            loaderVersion?: string
          }) => {
            useProcessesStore.getState().finish(current, 'done')
            emitNotification('info', 'Server installed')
            if (!d?.targetDir) return
            useInstallStore.getState().finish({
              targetDir: d.targetDir,
              mcVersion: d.mcVersion ?? '',
              loader: d.loader ?? '',
              loaderVersion: d.loaderVersion ?? '',
            })
            // Put the add-server form up behind the modal, filled in, so
            // "Add server" there is a dismissal rather than a handoff.
            useUiStore.getState().openServerManager(NEW_SERVER)
          },
        ),
      )
      offs.push(
        EventsOn(EVENTS.INSTALL_FAILED, (d?: { error?: string }) => {
          useProcessesStore.getState().finish(current, 'failed')
          useInstallStore.getState().fail(d?.error ?? 'The installer failed.')
          emitNotification('crash', `Server install failed${d?.error ? ': ' + d.error : ''}`)
        }),
      )
    } catch {
      /* non-Wails context */
    }
    return () => {
      for (const off of offs) {
        try {
          off()
        } catch {
          /* teardown no-op */
        }
      }
    }
  }, [])

  // Loader update → the update dialog's log and outcome, plus the sidebar chip.
  // Its log rides on install:log, which the installer emits for both a first
  // install and an update; the loader:update-* events are what tell the two
  // apart, so the log listener is only armed while an update is running.
  useEffect(() => {
    const offs: Array<() => void> = []
    const key = (id?: string) => 'loader:' + (id ?? '')
    let current = key()
    try {
      offs.push(
        EventsOn(
          EVENTS.LOADER_UPDATE_STARTED,
          (d?: { serverID?: string; from?: string; to?: string }) => {
            current = key(d?.serverID)
            // The event is the only thing that knows a job exists, and it
            // carries the job's identity — which is why the store takes it from
            // here rather than from whatever the dialog was last pointed at.
            useLoaderStore.getState().jobStarted({
              serverId: d?.serverID ?? '',
              from: d?.from ?? '',
              to: d?.to ?? '',
            })
            // The installer reports log lines, never a percentage.
            useProcessesStore.getState().start(current, `Updating loader to ${d?.to ?? ''}…`, {
              indeterminate: true,
              view: { kind: 'loader', serverId: d?.serverID ?? '' },
            })
          },
        ),
      )
      offs.push(
        EventsOn(EVENTS.LOADER_UPDATE_FINISHED, (d?: { version?: string }) => {
          useProcessesStore.getState().finish(current, 'done')
          useLoaderStore.getState().finishUpdate()
          emitNotification('info', `Loader updated to ${d?.version ?? 'a new build'}`)
        }),
      )
      offs.push(
        EventsOn(EVENTS.LOADER_UPDATE_FAILED, (d?: { error?: string; rolledBack?: boolean }) => {
          useProcessesStore.getState().finish(current, 'failed')
          useLoaderStore
            .getState()
            .failUpdate(d?.error ?? 'The loader update failed.', d?.rolledBack ?? false)
          emitNotification('crash', `Loader update failed${d?.error ? ': ' + d.error : ''}`)
        }),
      )
      // install:log carries the installer's output for both a first install
      // and a loader update — the backend reuses it deliberately so one log
      // view serves both. The two can never run at once (both hold the
      // installer's single-run guard), so whichever is in its running phase
      // owns the line.
      offs.push(
        EventsOn(EVENTS.INSTALL_LOG, (d?: { line?: string }) => {
          const line = d?.line ?? ''
          if (useLoaderStore.getState().phase === 'running') {
            useLoaderStore.getState().appendLog(line)
          } else if (useInstallStore.getState().phase === 'running') {
            useInstallStore.getState().appendLog(line)
          }
        }),
      )
    } catch {
      /* non-Wails context */
    }
    return () => {
      for (const off of offs) {
        try {
          off()
        } catch {
          /* teardown no-op */
        }
      }
    }
  }, [])

  // Scheduler notify block → in-app notification
  useEffect(() => {
    let cleanup: (() => void) | undefined
    try {
      cleanup = EventsOn(EVENTS.SCHEDULE_NOTIFY, (data: { kind: string; message: string }) => {
        const kind = (['info', 'warn', 'error'].includes(data.kind) ? data.kind : 'info') as
          'info' | 'warn' | 'error'
        emitNotification(kind, data.message)
      })
    } catch {
      /* non-Wails context */
    }
    return () => {
      try {
        cleanup?.()
      } catch {
        /* teardown no-op */
      }
    }
  }, [])

  // Server started notification
  useEffect(() => {
    let cleanup: (() => void) | undefined
    try {
      cleanup = EventsOn(EVENTS.SERVER_STARTED, () => {
        emitNotification('info', 'Server started')
      })
    } catch {
      /* non-Wails context */
    }
    return () => {
      try {
        cleanup?.()
      } catch {
        /* teardown no-op */
      }
    }
  }, [])

  // Player left notifications — shares the join toggle (player-activity alerts)
  useEffect(() => {
    let cleanup: (() => void) | undefined
    try {
      // server.go emits {name} — not a bare string.
      cleanup = EventsOn(EVENTS.PLAYER_LEFT, (d?: { name?: string }) => {
        if (!d?.name) return
        const { settings } = useSettingsStore.getState()
        if (settings.notifyOnJoin) {
          emitNotification('join', `${d.name} left the game`)
        }
      })
    } catch {
      /* non-Wails context */
    }
    return () => {
      try {
        cleanup?.()
      } catch {
        /* teardown no-op */
      }
    }
  }, [])

  // Low-TPS warning — edge-triggered with 14/15 hysteresis so a sustained dip
  // warns once, not every 10s snapshot; re-arms only after TPS recovers.
  useEffect(() => {
    let cleanup: (() => void) | undefined
    try {
      cleanup = EventsOn(EVENTS.STATS_SNAPSHOT, (snap: { tps: number }) => {
        if (snap.tps > 0 && snap.tps < 14 && !lowTpsWarned.current) {
          lowTpsWarned.current = true
          emitNotification('warn', `TPS dropped to ${snap.tps.toFixed(1)} (below 14)`)
        } else if (snap.tps >= 15) {
          lowTpsWarned.current = false
        }
      })
    } catch {
      /* non-Wails context */
    }
    return () => {
      try {
        cleanup?.()
      } catch {
        /* teardown no-op */
      }
    }
  }, [])

  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        className={`border-r-hairline border-border-subtle flex shrink-0 flex-col overflow-y-auto ${
          navFrozen ? 'pointer-events-none' : ''
        }`}
        // eslint-disable-next-line no-restricted-syntax -- navWidth is a live drag-computed value
        style={{ width: navWidth }}
      >
        <div className="border-b-hairline border-border-subtle flex shrink-0 items-center justify-between px-3 py-3">
          <span className="text-accent font-display text-sm font-black tracking-tight">
            Konnekt
          </span>
          <IconButton onClick={() => setSettingsOpen(true)} title="Settings">
            <Icon icon={Settings} />
          </IconButton>
        </div>
        {/* One scrolling column for all four sections, rather than a fixed
            server list, a scrolling crate and a panel pinned to the bottom
            edge. Each section draws its own card now, so the rules that used to
            separate them are gone, and the gap between the cards is what reads
            as the separation. Layouts is in here with the rest rather than
            pinned below: pinned, it had to grow upwards to keep its header
            still, which is not a shape a tile can have. */}
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
          <ServerSelector />
          <TileCrate />
          <LayoutPresets />
        </div>
        {/* Stays outside the scroller and below it: live work is status, not a
            section, and it has to be visible while the column above is
            scrolled somewhere else. */}
        <ActiveProcesses />
      </aside>
      {/* Straddles the navbar's border on a negative margin, so it is 4px of
          grab area that costs the layout nothing and the canvas does not shift
          the moment the pointer nears it. `relative` is what keeps <main> from
          taking the half that overlaps it, since a later sibling would
          otherwise win the hit test.

          What lights up is the hairline inside, not the whole grab area: the
          target wants to be forgiving, the line it draws does not. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize navbar"
        onMouseDown={onHandleMouseDown}
        onDoubleClick={onHandleDoubleClick}
        className="group relative z-10 -mx-0.5 flex w-1 shrink-0 cursor-col-resize justify-center bg-transparent"
      >
        <div className="group-hover:bg-accent group-active:bg-accent h-full w-px transition-colors" />
      </div>
      <main className="flex-1 overflow-hidden">
        <Dashboard />
      </main>

      {eulaRequired && <EulaModal serverId={activeId} onClose={() => setEulaRequired(false)} />}

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Every overlay below is rendered here, after <main>, on purpose. A
          fixed overlay inside <aside> carries the same z-50 as the
          maximized-tile overlay inside <main> and comes earlier in the
          document, so the tile wins the tie and the overlay opens underneath
          it. Document order is what puts these on top. */}
      <ServerManager />
      <DisconnectConfirm />
      {installOpen && <ServerInstallModal />}
      {loaderDialogOpen && <LoaderUpdateDialog />}
    </div>
  )
}

export default App
