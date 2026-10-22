// aislop-ignore-file code-quality/duplicate-block -- #313
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
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
import type { SettingsSection } from './components/SettingsModal'
import { useInstallStore } from './stores/useInstallStore'
import { useLoaderStore } from './stores/useLoaderStore'
import { useUiStore } from './stores/useUiStore'
import { useServerConfigStore } from './stores/useServerConfigStore'
import { useSettingsStore } from './stores/useSettingsStore'
import { useProcessesStore } from './stores/useProcessesStore'
import { emitNotification } from './lib/appNotify'
import { deliverScheduleNotify } from './lib/scheduleNotify'
import { failedRunToast, showToast } from './lib/toast'
import type { RunFinished } from './lib/toast'
import { useNotificationsStore } from './stores/useNotificationsStore'
import { useUpdateCheck } from './hooks/useUpdateCheck'
import { useServerStatusSync } from './hooks/useServerStatus'
import { useConsoleSync } from './hooks/useConsoleSync'
import { useCommandsSync } from './hooks/useCommandsSync'
import { useRemoteSync } from './hooks/useRemoteSync'
import { useRemoteStore } from './stores/useRemoteStore'
import { useNavWidth } from './hooks/useNavWidth'
import { TitleBar } from './components/TitleBar'
import { EVENTS } from './lib/constants'
import { hasWailsBridge, isRemoteBrowser } from './lib/ipc'

// Remote mode only; a dynamic import keeps lib/remoteRuntime out of the entry chunk.
// The desktop's approval dialog, fetched the first time something waits on it:
// most sessions never raise one, and the entry chunk has a budget.
const RemotePrompts = lazy(() =>
  import('./components/RemotePrompts').then((m) => ({ default: m.RemotePrompts })),
)
// The server a bubble is about, by name: with several configured, "Server
// crashed" alone does not say which. Falls back to the id, then to nothing.
function serverLabel(serverID?: string): string {
  if (!serverID) return ''
  const cfg = useServerConfigStore.getState().configs.find((c) => c.id === serverID)
  return cfg?.name || serverID
}

function titled(title: string, serverID?: string): string {
  const name = serverLabel(serverID)
  return name ? `${title}: ${name}` : title
}

// The bubble layer, fetched with the first bubble: most sessions raise none,
// and the entry chunk has a budget. The store that holds them is eager, so a
// bubble raised before the chunk arrives is drawn when it does.
const Toasts = lazy(() => import('./components/Toasts').then((m) => ({ default: m.Toasts })))
// Fetched with the first open: the entry chunk has a budget, and Settings is
// the largest dialog nothing needs before the user asks for it.
const SettingsModal = lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal })),
)
const RemoteBanner = lazy(() =>
  import('./components/RemoteChrome').then((m) => ({ default: m.RemoteBanner })),
)

function App() {
  const { activeId } = useServerConfigStore()
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const checkUpdatesOnStartup = useSettingsStore((s) => s.settings.checkUpdatesOnStartup)
  const installOpen = useInstallStore((s) => s.open)
  const loaderDialogOpen = useLoaderStore((s) => s.dialogOpen)
  const hasToasts = useNotificationsStore((s) => s.toasts.length > 0)
  // Fetched with the first bubble and kept mounted from then on: the last
  // bubble's exit animation runs after the store has let it go, so unmounting
  // the layer with an empty store would cut it off.
  const [toastLayer, setToastLayer] = useState(false)
  if (hasToasts && !toastLayer) setToastLayer(true)
  // The server whose eula.txt needs accepting, or null. A string rather than
  // a flag because the prompt is for the server that tripped it, which is not
  // always the selected one: a schedule can start another server (#236).
  const [eulaFor, setEulaFor] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Kept mounted from the first open, so closing runs the exit animation
  // rather than unmounting the dialog mid-frame.
  const [settingsLayer, setSettingsLayer] = useState(false)
  if (settingsOpen && !settingsLayer) setSettingsLayer(true)
  // The section Settings opens on, set by the title bar's Remote chip and
  // cleared by the gear, so the gear opens Settings on its own default.
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>(undefined)
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
  // Below 640px the nav is the home screen and a maximized tile is a page, so
  // the two swap on this and the grid is never drawn.
  const tileOpen = useUiStore((s) => s.maximizedTileId !== null)
  const autoStarted = useRef(false)
  const lowTpsWarned = useRef(false)

  useEffect(() => {
    useSettingsStore.getState().load()
  }, [])

  useUpdateCheck(settingsLoaded && checkUpdatesOnStartup)

  // Mounted here, not in the stats tile: six components read the resulting
  // status and tiles are removable, so tying it to one tile left the rest
  // reading a stale offline default (see the hook's own comment).
  useServerStatusSync(activeId)
  useConsoleSync(activeId)
  useCommandsSync()
  // Here for the same reason: the prompts and the title bar chip both read it.
  useRemoteSync()
  const remoteWaiting = useRemoteStore(
    (s) => s.access.pendingDevices.length + s.access.approvals.length > 0,
  )

  // Auto-start active server on launch
  useEffect(() => {
    if (!settingsLoaded || !activeId || autoStarted.current) return
    if (useSettingsStore.getState().settings.autoStartActiveServer) {
      autoStarted.current = true
      // A write, so `hasWailsBridge()` rather than `readOr` (see lib/ipc.ts).
      // With no bridge the binding throws synchronously, past this `.catch()`
      // and out of the effect; there was also never a server to start, so
      // there is nothing to report and nothing to retry.
      if (hasWailsBridge()) {
        StartServer(activeId).catch(() => {
          /* already running or no server */
        })
      }
    }
  }, [settingsLoaded, activeId])

  useEffect(() => {
    let cleanup: (() => void) | undefined
    try {
      // An empty serverID is the bootstrap instance (models/server.go), and
      // the selected server is the only one that can have been started
      // without an id, so it stands in rather than the prompt going missing.
      cleanup = EventsOn(EVENTS.EULA_REQUIRED, (p?: { serverID?: string }) =>
        setEulaFor(p?.serverID || useServerConfigStore.getState().activeId || ''),
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

  // Server stopped — detect crash vs. deliberate stop
  useEffect(() => {
    let cleanup: (() => void) | undefined
    try {
      cleanup = EventsOn(
        EVENTS.SERVER_STOPPED,
        (payload?: { expected?: boolean; exitCode?: number; serverID?: string }) => {
          if (payload?.expected) return
          const code = payload?.exitCode
          const detail =
            typeof code !== 'number'
              ? ''
              : code === -1
                ? ' (killed by a signal)'
                : ` (exit code ${code})`
          const text = `Server stopped unexpectedly${detail}`
          // App-wide on purpose: a crash on any server should be heard about.
          // The id names the server rather than filtering the event out.
          showToast({
            key: `crash:${payload?.serverID ?? ''}`,
            category: 'crash',
            tone: 'error',
            title: titled('Server crashed', payload?.serverID),
            text,
          })
          emitNotification('crash', text)
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
        emitNotification('join', `${d.name} joined the game`)
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
    let c6: (() => void) | undefined
    let c7: (() => void) | undefined
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
        emitNotification('crash', `Backup failed${data?.error ? ': ' + data.error : ''}`, 'errors')
        showToast({
          category: 'errors',
          tone: 'error',
          title: titled('Backup failed', data?.serverID),
          text: data?.error || 'The backup failed.',
        })
      })
      // No processes row to finish: a restore never opens one. Restore used
      // to fail through BACKUP_FAILED and toast as a failed backup (#280).
      c6 = EventsOn(EVENTS.RESTORE_FAILED, (data?: { error?: string }) => {
        emitNotification('crash', `Restore failed${data?.error ? ': ' + data.error : ''}`, 'errors')
        showToast({
          category: 'errors',
          tone: 'error',
          title: 'Restore failed',
          text: data?.error || 'The restore failed.',
        })
      })
      // Not a backup failure: the archive may be fine and the server is what
      // needs attention, since autosave stays off until it restarts (#309).
      c7 = EventsOn(EVENTS.AUTOSAVE_STUCK, (data?: { error?: string }) => {
        const text = `Auto-save is still off: the server did not accept save-on${data?.error ? ' (' + data.error + ')' : ''}`
        emitNotification('warn', text)
        showToast({ category: 'warnings', tone: 'warn', title: 'Auto-save is off', text })
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
      try {
        c6?.()
      } catch {
        /* teardown no-op */
      }
      try {
        c7?.()
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
          emitNotification(
            'crash',
            `Server install failed${d?.error ? ': ' + d.error : ''}`,
            'errors',
          )
          showToast({
            category: 'errors',
            tone: 'error',
            title: 'Server install failed',
            text: d?.error || 'The installer failed.',
          })
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
          emitNotification(
            'crash',
            `Loader update failed${d?.error ? ': ' + d.error : ''}`,
            'errors',
          )
          showToast({
            category: 'errors',
            tone: 'error',
            title: 'Loader update failed',
            text: d?.error || 'The loader update failed.',
          })
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

  // A failed run, from any server and whatever started it: most runs are on a
  // schedule, with no editor open to say so. The console has the line already,
  // from the backend; this is the bubble and the Notifications tile.
  useEffect(() => {
    let cleanup: (() => void) | undefined
    try {
      cleanup = EventsOn(
        EVENTS.SCHEDULE_RUN_FINISHED,
        (p?: RunFinished & { serverID?: string }) => {
          const toast = failedRunToast(p)
          if (!toast) return
          emitNotification('error', `${toast.title}. ${toast.text}`)
          showToast({ ...toast, title: titled(toast.title, p?.serverID) })
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

  // Scheduler notify block → in-app and/or desktop notification, per its deliver choice
  useEffect(() => {
    let cleanup: (() => void) | undefined
    try {
      cleanup = EventsOn(EVENTS.SCHEDULE_NOTIFY, deliverScheduleNotify)
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

  // Player left notifications: shares the join desktop toggle
  useEffect(() => {
    let cleanup: (() => void) | undefined
    try {
      // server.go emits {name} — not a bare string.
      cleanup = EventsOn(EVENTS.PLAYER_LEFT, (d?: { name?: string }) => {
        if (!d?.name) return
        emitNotification('join', `${d.name} left the game`)
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
          const text = `TPS dropped to ${snap.tps.toFixed(1)} (below 14)`
          emitNotification('warn', text)
          showToast({ key: 'low-tps', category: 'warnings', tone: 'warn', title: 'Low TPS', text })
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
    // A column now, not a row: the app draws its own title bar across the top
    // (see components/TitleBar.tsx and main.go's Frameless), and the navbar and
    // the canvas share the space under it. min-h-0 on the row is what keeps the
    // navbar's own scroller scrolling instead of growing the flex item past the
    // viewport.
    <div className="flex h-screen flex-col overflow-hidden">
      <TitleBar
        onOpenSettings={() => {
          setSettingsSection(undefined)
          setSettingsOpen(true)
        }}
        onOpenRemote={
          isRemoteBrowser()
            ? undefined
            : () => {
                setSettingsSection('remote')
                setSettingsOpen(true)
              }
        }
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className={`border-r-hairline border-border-subtle flex shrink-0 flex-col overflow-y-auto max-sm:!w-full max-sm:border-r-0 ${
            navFrozen ? 'pointer-events-none' : ''
          } ${tileOpen ? 'max-sm:hidden' : ''}`}
          // eslint-disable-next-line no-restricted-syntax -- navWidth is a live drag-computed value
          style={{ width: navWidth }}
        >
          {/* Horizontal padding comes from .scroll-stable, which nets the
              scrollbar's reserved gutter out of it so the cards sit evenly
              between the navbar's edges whether or not the platform reserves one.
              It is the same 12px this py-3 is, so the column is inset equally on
              all three sides.

              py-3, matching Dashboard.tsx's GRID_CONTAINER_PADDING[1] — keep the
              two in step, it is module-private there and reaching it from here
              would mean an inline style the lint rule restricts. That is the
              whole point of the title bar: with the wordmark and the gear moved
              up into it, this column has no header left to clear, so its first
              card starts at the same 12px inset as the canvas's first tile and
              the two columns finally begin on one line. It was py-2 under a 52px
              header, which put them a header apart.

              gap-3, which is Dashboard.tsx's GRID_MARGIN[1] and the same 12px
              again. The column's inset and the space between its cards are one
              rhythm, the canvas's, so nothing in either column is measured
              against a value the other does not use. It was gap-2, left over
              from when the whole column was on an 8px scale.

              One scrolling column for all four sections, rather than a fixed
              server list, a scrolling crate and a panel pinned to the bottom
              edge. Each section draws its own card now, so the rules that used to
              separate them are gone, and the gap between the cards is what reads
              as the separation. Layouts is in here with the rest rather than
              pinned below: pinned, it had to grow upwards to keep its header
              still, which is not a shape a tile can have. */}
          <div className="scroll-stable flex flex-1 flex-col gap-3 py-3">
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
          className="group relative z-10 -mx-0.5 flex w-1 shrink-0 cursor-col-resize justify-center bg-transparent max-sm:hidden"
        >
          <div className="group-hover:bg-accent group-active:bg-accent h-full w-px transition-colors" />
        </div>
        {/* A phone never draws the grid: with no tile open the nav is the page. */}
        <main className={`flex-1 overflow-hidden ${tileOpen ? '' : 'max-sm:hidden'}`}>
          <Dashboard />
        </main>
      </div>

      {eulaFor !== null && <EulaModal serverId={eulaFor} onClose={() => setEulaFor(null)} />}

      {settingsLayer && (
        <Suspense fallback={null}>
          <SettingsModal
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            initialSection={settingsSection}
          />
        </Suspense>
      )}

      {/* Every overlay below is rendered here, after <main>, on purpose, and
          for two reasons that are not the z-index: <aside> goes
          pointer-events-none while the navbar is resized or a crate drag is
          in flight, and a nested overlay would inherit that; and an overlay
          opened from inside another overlay's subtree is clamped in that
          overlay's stacking context. Which of these sits above the maximized
          tile is the layering scale's call (lib/layers.ts: z-modal and
          z-dialog over z-overlay), not document order. It used to be the
          latter, which is how the manager opened underneath an open tile. */}
      <ServerManager />
      <DisconnectConfirm />
      {/* Never in a remote browser: its store is never loaded (useRemoteSync),
          so nothing is ever waiting there. */}
      {remoteWaiting && (
        <Suspense fallback={null}>
          <RemotePrompts />
        </Suspense>
      )}
      {isRemoteBrowser() && (
        <Suspense fallback={null}>
          <RemoteBanner />
        </Suspense>
      )}
      {installOpen && <ServerInstallModal />}
      {loaderDialogOpen && <LoaderUpdateDialog />}
      {toastLayer && (
        <Suspense fallback={null}>
          <Toasts />
        </Suspense>
      )}
    </div>
  )
}

export default App
