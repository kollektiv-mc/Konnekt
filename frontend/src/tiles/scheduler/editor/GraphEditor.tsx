import { useState, useCallback, useEffect, useRef, useMemo, type DragEvent } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  useUpdateNodeInternals,
  type Connection,
  type Node as FlowNode,
  type Edge as FlowEdge,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react'
import {
  CATEGORY_COLOR,
  DATA_EDGE_STYLE,
  isCommandHandleWired,
  nodeEffects,
  NODE_EFFECT_STOPS_SERVER,
} from './blockMeta'
import { SchedulerCtx, type NodeRunState } from './schedulerContext'
import { BlockNode } from './BlockNode'
import { AnimatedEdge } from './AnimatedEdge'
import { BlockPalette, PaletteToggle } from './BlockPalette'
import { GRID_DOT_OFFSET, GRID_DOT_SIZE, GRID_GAP, SNAP_GRID } from './canvasGrid'
import { NodePanel } from './NodePanel'
import { NodeMenuHost } from './NodeMenuHost'
import type { NodeMenuRequest } from './NodeMenuHost'
import { QuickAddHost } from './QuickAddHost'
import type { QuickAddRequest } from './QuickAddHost'
import { Toolbar } from './Toolbar'
import { centerNodes, takeMeasured } from './centerOnMeasure'
import { warningLine, warningRows, warningsByNode } from './graphWarnings'
import { RUN_RUNNING, runOutcome, type RunStatus } from './runStatus'
import { useNotificationsStore } from '../../../stores/useNotificationsStore'
import type { ToastInput } from '../../../stores/useNotificationsStore'
import { useSettingsStore } from '../../../stores/useSettingsStore'
import {
  graphToFlow,
  flowToGraph,
  graphSignature,
  isValidConnection as isValidGraphConnection,
  randId,
  defaultConfig,
  detectControlCycles,
  type NodeData,
  type BlockFlowNode,
} from './graphMapping'
import {
  captureSelection,
  clipboardAction,
  instantiateSlice,
  pasteDelta,
  pasteStep,
  readClipboard,
  writeClipboard,
  type ClipboardSlice,
} from './clipboard'
import { CloseConfirmDialog } from './CloseConfirmDialog'
import { editMenuRows, editMenuState, type EditMenuActions } from './editMenuRows'
import { applySelection, type SelectionSpec } from './selection'
import { useDirtyGuard } from './useDirtyGuard'
import { useNodeGlow } from './useNodeGlow'
import {
  emptyHistory,
  record as recordHistory,
  undo as undoHistory,
  redo as redoHistory,
  canUndo,
  canRedo,
  type HistoryState,
  type GraphSnapshot,
} from './graphHistory'
import { EventsOn } from '../../../../wailsjs/runtime/runtime'
import { EVENTS, scheduleRunToastKey } from '../../../lib/constants'
import { useUiStore } from '../../../stores/useUiStore'
import { useSchedulerStore } from '../../../stores/useSchedulerStore'
import { useServerStore } from '../../../stores/useServerStore'
import type { models } from '../../../../wailsjs/go/models'

// schedule:* event payload shapes (emitted by the Go engine via EventBus).
interface RunEvt {
  graphId: string
}
interface NodeEvt {
  graphId: string
  nodeId: string
  status?: string
  firedPort?: string
  downtimeMs?: number
  warning?: string
  error?: string
}

const RUN_CLEAR_MS = 2400

// The bubbles this editor raises. One editor is open at a time, so a fixed key
// per kind is enough, and it is what lets a dismissal hold across a reopen. A
// failed run's is App's, keyed by graph (scheduleRunToastKey): it is raised for
// every run, and this only reopens it.
const TOAST_ERROR = 'scheduler:error'
const TOAST_WARNING = 'scheduler:warning'

// lib/toast.ts's showToast and withdrawToast, written against the two stores
// here. Importing lib/toast from this lazy chunk made Rolldown hoist six of the
// entry's modules into helper chunks, 2.3 KB over the entry budget for no code
// of its own; the stores are shared with the entry already and move nothing.
function showToast(input: ToastInput, force = false): void {
  if (!force && useSettingsStore.getState().settings.toastsOff[input.category]) return
  useNotificationsStore.getState().showToast(input, force)
}

function withdrawToast(key: string): void {
  useNotificationsStore.getState().withdrawToast(key)
}

const nodeTypes = { block: BlockNode }
const edgeTypes = { wire: AnimatedEdge }

const NODE_BASE_MS = 80
const NODE_STAGGER = 25
const EDGE_BASE_MS = 280
const EDGE_STAGGER = 20

interface GraphEditorProps {
  graphs: models.Graph[]
  blockDefs: models.BlockDef[]
  onSave: (g: models.Graph) => Promise<models.Graph>
  onDelete: (id: string) => Promise<void>
  onSetEnabled: (id: string, enabled: boolean) => Promise<void>
  onRun: (id: string) => Promise<models.RunRecord>
  onPreviewNode: (graph: models.Graph, nodeId: string) => Promise<models.NodePreview>
}

// Outer wrapper provides ReactFlowProvider so useReactFlow() works inside.
/**
 * Backspace as well as Delete, the way every node editor people arrive from
 * binds it (#159). Editor chrome opts out of key handling with NO_GRAPH_KEYS,
 * because the library's own guard covers inputs and not buttons.
 *
 * Module-level so the identity is stable. React Flow's useKeyPress holds the
 * key prop in its effect dependencies, so a fresh array literal on each render
 * would rebind four document listeners every time the graph re-renders, which
 * is every node drag.
 */
const DELETE_KEYS = ['Delete', 'Backspace']

export function GraphEditor(props: GraphEditorProps) {
  return (
    <ReactFlowProvider>
      <GraphEditorInner {...props} />
    </ReactFlowProvider>
  )
}

function GraphEditorInner({
  graphs,
  blockDefs,
  onSave,
  onDelete,
  onSetEnabled,
  onRun,
  onPreviewNode,
}: GraphEditorProps) {
  const { screenToFlowPosition, fitView } = useReactFlow()
  const curvedEdges = useSettingsStore((s) => s.settings.schedulerCurvedEdges)
  const snapToGrid = useSettingsStore((s) => s.settings.schedulerSnapToGrid)
  const updateSettings = useSettingsStore((s) => s.update)
  const updateNodeInternals = useUpdateNodeInternals()

  const defMap = useMemo(() => new Map(blockDefs.map((d) => [d.id, d])), [blockDefs])

  // ── Graph metadata ────────────────────────────────────────────────────────
  const [graphId, setGraphId] = useState<string | null>(null)
  const [graphName, setGraphName] = useState('')
  const [graphEnabled, setGraphEnabled] = useState(false)
  const [createdAt, setCreatedAt] = useState(0)

  // ── Canvas state ──────────────────────────────────────────────────────────
  const [nodes, setNodes, onNodesChange] = useNodesState<BlockFlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [panelTab, setPanelTab] = useState<'config' | 'data'>('config')

  // ── Undo/redo history (up to 10 past actions, tile-local — see graphHistory.ts) ──
  const [history, setHistory] = useState<HistoryState>(emptyHistory())
  const historyRef = useRef<HistoryState>(history)
  const nodesRef = useRef<BlockFlowNode[]>(nodes)
  const dragSnapshotRef = useRef<GraphSnapshot | null>(null)

  // ── UI state ──────────────────────────────────────────────────────────────
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const runStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Read straight from the store rather than threading another prop through:
  // the graph data itself still arrives via props from the tile's hook.
  const schedulerError = useSchedulerStore((s) => s.error)
  const clearSchedulerError = useSchedulerStore((s) => s.clearError)
  const askGraphWarnings = useSchedulerStore((s) => s.graphWarnings)
  const serverState = useServerStore((s) => s.status.state)

  // ── Unsaved-changes guard ─────────────────────────────────────────────────
  // State (not a ref) so changing it — on load/save/discard — reliably
  // invalidates the `dirty` memo below. It starts as the signature of the empty
  // editor rather than '', which no signature equals: that read as dirty until a
  // graph loaded, and for good on a server with none (#526).
  const [savedSig, setSavedSig] = useState(() =>
    graphSignature({ name: '', enabled: false }, [], []),
  )
  const dirty = useMemo(
    () => graphSignature({ name: graphName, enabled: graphEnabled }, nodes, edges) !== savedSig,
    [graphName, graphEnabled, nodes, edges, savedSig],
  )
  const dirtyRef = useRef(false)
  // The pending handle re-measure loadGraph schedules, so a second load or an
  // unmount can cancel it.
  const remeasureTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  // One dialog for every action that replaces what the editor holds: closing
  // the maximized tile, switching graphs, and starting a new one (#124). The
  // continuation travels with the request, so the dialog itself knows nothing
  // about which of the three asked.
  const confirm = useDirtyGuard(() => dirtyRef.current)
  // Pulled out for the close-guard effect's dependency list. Every callback the
  // hook returns is stable by construction, but exhaustive-deps only sees the
  // member expression and asks for the whole object, which is a new one each
  // render and would re-register the guard on every node drag.
  const { hold: holdConfirm } = confirm

  // Veto a Dashboard-initiated close (Escape / backdrop / restore button /
  // navbar) or a server switch while there are unsaved changes, in favor of our
  // own confirm dialog, which runs whichever of the two asked once the user
  // agrees. Registered only while this editor is mounted (i.e. maximized).
  const setCloseGuard = useUiStore((s) => s.setCloseGuard)
  useEffect(() => {
    setCloseGuard((proceed) => {
      if (!dirtyRef.current) return false
      holdConfirm(proceed)
      return true
    })
    return () => setCloseGuard(null)
  }, [setCloseGuard, holdConfirm])

  // ── Live run highlighting (driven by schedule:* events) ───────────────────
  const [nodeRunState, setNodeRunState] = useState<Map<string, NodeRunState>>(new Map())
  const [nodeDowntimeMs, setNodeDowntimeMs] = useState<Map<string, number>>(new Map())
  const [nodeWarning, setNodeWarning] = useState<Map<string, string>>(new Map())
  const [nodeFailure, setNodeFailure] = useState<Map<string, string>>(new Map())
  const [firedEdges, setFiredEdges] = useState<Set<string>>(new Set())
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Refs so the event handlers (registered once) read current graph + edges.
  const graphIdRef = useRef<string | null>(null)
  const edgesRef = useRef<FlowEdge[]>([])

  const [quickAdd, setQuickAdd] = useState<QuickAddRequest | null>(null)
  // The edit menu a right-click on a block opens (#181). It and quick-add are
  // never open together: each opening clears the other.
  const [nodeMenu, setNodeMenu] = useState<NodeMenuRequest | null>(null)
  const canvasWrapperRef = useRef<HTMLDivElement>(null)
  useNodeGlow(canvasWrapperRef)
  const mousePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  // Track cursor so Tab opens the quick-add menu at the pointer, not canvas center.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      mousePos.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('mousemove', handler)
    return () => window.removeEventListener('mousemove', handler)
  }, [])

  // A failure stays until clicked away; anything else clears after 4 s.
  const showRunStatus = useCallback((status: RunStatus | null) => {
    setRunStatus(status)
    if (runStatusTimer.current) clearTimeout(runStatusTimer.current)
    if (status && !status.failed && status !== RUN_RUNNING) {
      runStatusTimer.current = setTimeout(() => setRunStatus(null), 4000)
    }
  }, [])

  // The full reason for a failed run is in App's bubble, raised from the run's
  // event: the toolbar only has room to say that it failed, and clicking that
  // brings the bubble back, dismissed or with its category off.
  const reopenRunToast = useCallback(
    (status: RunStatus) => {
      showToast(
        {
          key: scheduleRunToastKey(graphId ?? ''),
          category: 'errors',
          tone: 'error',
          title: `Run failed: ${graphName || 'Untitled'}`,
          text: status.detail ?? status.text,
        },
        true,
      )
    },
    [graphId, graphName],
  )

  // A store error (a save, a delete, a toggle the backend refused) goes to a
  // bubble the same way, and the toolbar keeps the two-word indicator for it.
  const showErrorToast = useCallback(
    (force = false) => {
      if (!schedulerError) return
      showToast(
        {
          key: TOAST_ERROR,
          category: 'errors',
          tone: 'error',
          title: 'Scheduler error',
          text: schedulerError,
        },
        force,
      )
    },
    [schedulerError],
  )
  useEffect(() => {
    if (schedulerError) showErrorToast()
  }, [schedulerError, showErrorToast])

  // Keep refs in sync so the once-registered event handlers see current state.
  useEffect(() => {
    edgesRef.current = edges
  }, [edges])
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])
  useEffect(() => {
    graphIdRef.current = graphId
  }, [graphId])
  useEffect(() => {
    historyRef.current = history
  }, [history])

  // Snapshot the pre-mutation graph into history. Calls sharing the same tag
  // (e.g. successive keystrokes in one config field) coalesce into one entry.
  const recordPre = useCallback((tag: string | null = null) => {
    setHistory((h) => recordHistory(h, { nodes: nodesRef.current, edges: edgesRef.current }, tag))
  }, [])

  const applySnapshot = useCallback(
    (snapshot: GraphSnapshot) => {
      setNodes(snapshot.nodes)
      setEdges(snapshot.edges)
      setSelectedNodeId((id) => (id && snapshot.nodes.some((n) => n.id === id) ? id : null))
      const ids = snapshot.nodes.map((n) => n.id)
      setTimeout(() => updateNodeInternals(ids), 0)
    },
    [setNodes, setEdges, updateNodeInternals],
  )

  const doUndo = useCallback(() => {
    const result = undoHistory(historyRef.current, {
      nodes: nodesRef.current,
      edges: edgesRef.current,
    })
    if (!result) return
    setHistory(result.state)
    applySnapshot(result.snapshot)
  }, [applySnapshot])

  const doRedo = useCallback(() => {
    const result = redoHistory(historyRef.current, {
      nodes: nodesRef.current,
      edges: edgesRef.current,
    })
    if (!result) return
    setHistory(result.state)
    applySnapshot(result.snapshot)
  }, [applySnapshot])

  // ── Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo ─────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      const tag = (document.activeElement as HTMLElement | null)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      e.preventDefault()
      if (key === 'y' || (key === 'z' && e.shiftKey)) doRedo()
      else doUndo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [doUndo, doRedo])

  // ── Subscribe to live run events ──────────────────────────────────────────
  // The engine emits these for every graph; we only reflect the loaded one.
  useEffect(() => {
    const reset = () => {
      setNodeRunState(new Map())
      setFiredEdges(new Set())
    }

    let offRunStart: (() => void) | undefined
    let offNodeStart: (() => void) | undefined
    let offNodeFin: (() => void) | undefined
    let offRunFin: (() => void) | undefined
    try {
      offRunStart = EventsOn(EVENTS.SCHEDULE_RUN_STARTED, (p: RunEvt) => {
        if (p.graphId !== graphIdRef.current) return
        if (clearTimer.current) clearTimeout(clearTimer.current)
        reset()
        setNodeDowntimeMs(new Map())
        setNodeWarning(new Map())
        setNodeFailure(new Map())
      })
      offNodeStart = EventsOn(EVENTS.SCHEDULE_NODE_STARTED, (p: NodeEvt) => {
        if (p.graphId !== graphIdRef.current) return
        setNodeRunState((m) => new Map(m).set(p.nodeId, 'running'))
      })
      offNodeFin = EventsOn(EVENTS.SCHEDULE_NODE_FINISHED, (p: NodeEvt) => {
        if (p.graphId !== graphIdRef.current) return
        setNodeRunState((m) =>
          new Map(m).set(p.nodeId, p.status === 'failed' ? 'failed' : 'success'),
        )
        const downtimeMs = p.downtimeMs
        if (downtimeMs) setNodeDowntimeMs((m) => new Map(m).set(p.nodeId, downtimeMs))
        const warning = p.warning
        if (warning) setNodeWarning((m) => new Map(m).set(p.nodeId, warning))
        // Kept past the highlight, which clears when the run does: the block's
        // triangle stays red until the next run says otherwise.
        if (p.status === 'failed') setNodeFailure((m) => new Map(m).set(p.nodeId, p.error ?? ''))
        const fired = `ctrl:${p.firedPort ?? ''}`
        setFiredEdges((s) => {
          const next = new Set(s)
          for (const e of edgesRef.current) {
            if (e.source === p.nodeId && (e.sourceHandle ?? '') === fired) next.add(e.id)
          }
          return next
        })
      })
      offRunFin = EventsOn(EVENTS.SCHEDULE_RUN_FINISHED, (p: RunEvt) => {
        if (p.graphId !== graphIdRef.current) return
        if (clearTimer.current) clearTimeout(clearTimer.current)
        clearTimer.current = setTimeout(reset, RUN_CLEAR_MS)
      })
    } catch {
      /* Wails runtime unavailable in dev without backend */
    }

    return () => {
      offRunStart?.()
      offNodeStart?.()
      offNodeFin?.()
      offRunFin?.()
      if (clearTimer.current) clearTimeout(clearTimer.current)
    }
  }, [])

  // ── Right-click on canvas ─────────────────────────────────────────────────
  // A block opens the edit menu on the selection; the empty canvas (and an edge,
  // as before) opens quick-add. Capture-phase native listener fires before
  // WebView2 can show its native menu.
  useEffect(() => {
    const el = canvasWrapperRef.current
    if (!el) return
    const handler = (e: MouseEvent) => {
      e.preventDefault()
      const screen = { x: e.clientX, y: e.clientY }
      const flow = screenToFlowPosition(screen)
      const hit = e.target instanceof Element ? e.target.closest('.react-flow__node') : null
      const id = hit?.getAttribute('data-id') ?? null
      if (id === null || !nodesRef.current.some((n) => n.id === id)) {
        setNodeMenu(null)
        setQuickAdd({ screen, flow })
        return
      }
      // A block outside the selection becomes the selection, alone; one inside
      // it leaves the selection as it is, so the menu acts on all of it.
      if (!nodesRef.current.find((n) => n.id === id)?.selected) {
        setNodes((ns) =>
          ns.map((n) => (!!n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })),
        )
        setEdges((es) => es.map((x) => (x.selected ? { ...x, selected: false } : x)))
        setSelectedNodeId(id)
      }
      setQuickAdd(null)
      setNodeMenu({ screen, flow })
    }
    el.addEventListener('contextmenu', handler, true)
    return () => el.removeEventListener('contextmenu', handler, true)
  }, [screenToFlowPosition, setNodes, setEdges])

  // ── Tab key → open quick-add at cursor position ──────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const tag = (document.activeElement as HTMLElement | null)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      e.preventDefault()
      const { x: sx, y: sy } = mousePos.current
      const flow = screenToFlowPosition({ x: sx, y: sy })
      setNodeMenu(null)
      setQuickAdd({ screen: { x: sx, y: sy }, flow })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [screenToFlowPosition])

  // ── Load graph into canvas ────────────────────────────────────────────────
  const loadGraph = useCallback(
    (g: models.Graph) => {
      const { nodes: ns, edges: es } = graphToFlow(g, defMap)
      const animNodes = ns.map((n, i) => ({
        ...n,
        data: {
          ...n.data,
          _animDelay: NODE_BASE_MS + i * NODE_STAGGER + Math.floor(Math.random() * 25),
        } as NodeData,
      }))
      const animEdges = es.map((e, i) => ({
        ...e,
        data: { ...(e.data as object), _animDelay: EDGE_BASE_MS + i * EDGE_STAGGER },
      }))
      setNodes(animNodes)
      setEdges(animEdges)
      setGraphId(g.id)
      setGraphName(g.name)
      setGraphEnabled(g.enabled)
      setCreatedAt(g.createdAt)
      setSelectedNodeId(null)
      setNodeRunState(new Map())
      setNodeFailure(new Map())
      setFiredEdges(new Set())
      setSavedSig(graphSignature({ name: g.name, enabled: g.enabled }, animNodes, animEdges))
      setHistory(emptyHistory())
      // Re-measure handle positions after the maximize animation (panel animates
      // for 180ms). ReactFlow's initial measurement runs while the panel ancestor
      // may still have scale < 1, producing stale edge endpoints. Waiting 220ms
      // ensures getBoundingClientRect returns settled coordinates.
      const ids = ns.map((n) => n.id)
      if (remeasureTimer.current !== null) clearTimeout(remeasureTimer.current)
      remeasureTimer.current = setTimeout(() => {
        remeasureTimer.current = null
        updateNodeInternals(ids)
      }, 220)
    },
    [defMap, setNodes, setEdges, updateNodeInternals],
  )

  // The re-measure must not outlive the editor: closing the tile within 220ms of
  // a load fired it against an unmounted React Flow, and in a test it fired after
  // jsdom was torn down, where its requestAnimationFrame no longer exists.
  useEffect(
    () => () => {
      if (remeasureTimer.current !== null) clearTimeout(remeasureTimer.current)
    },
    [],
  )

  // Auto-load first graph when graphs list arrives
  useEffect(() => {
    if (graphs.length > 0 && graphId === null) {
      loadGraph(graphs[0])
    }
  }, [graphs, graphId, loadGraph])

  // ── Connect handler ───────────────────────────────────────────────────────
  const onConnect = useCallback(
    (connection: Connection) => {
      recordPre()
      const srcH = connection.sourceHandle ?? ''
      const isData = srcH.startsWith('data:')
      setEdges((es) =>
        addEdge(
          {
            ...connection,
            id: randId(),
            type: 'wire',
            style: isData ? DATA_EDGE_STYLE : undefined,
            data: { kind: isData ? 'data' : 'control' } as Record<string, unknown>,
          },
          es,
        ),
      )
    },
    [setEdges, recordPre],
  )

  const isValidConnection = useCallback(
    (c: FlowEdge | Connection) => isValidGraphConnection(c, nodes, defMap),
    [nodes, defMap],
  )

  // ── Alt+drag → duplicate node at its original position ───────────────────
  const onNodeDragStart = useCallback(
    (e: MouseEvent | TouchEvent, node: FlowNode) => {
      // Snapshot before any drag/duplicate mutation; onNodeDragStop decides
      // whether the gesture actually changed anything worth an undo entry.
      dragSnapshotRef.current = { nodes: nodesRef.current, edges: edgesRef.current }
      if (!('altKey' in e) || !e.altKey) return
      const newId = randId()
      setNodes((ns) => [
        ...ns,
        {
          ...(node as BlockFlowNode),
          id: newId,
          position: { ...node.position },
          selected: false,
          data: {
            ...(node.data as NodeData),
            config: { ...(node.data as NodeData).config },
          },
        },
      ])
      // Duplicate edges that target the original node so the copy is wired the same way.
      setEdges((es) => {
        const duped = es
          .filter((e) => e.target === node.id || e.source === node.id)
          .map((e) => ({
            ...e,
            id: randId(),
            source: e.source === node.id ? newId : e.source,
            target: e.target === node.id ? newId : e.target,
          }))
        return [...es, ...duped]
      })
    },
    [setNodes, setEdges],
  )

  // A completed drag (move, or Alt-drag duplicate+move) is one undo entry —
  // recorded here rather than on drag start, so a no-op click/Alt-click
  // (no actual position change or new node) doesn't pollute the history.
  const onNodeDragStop = useCallback(() => {
    const snap = dragSnapshotRef.current
    dragSnapshotRef.current = null
    if (!snap) return
    const changed =
      nodesRef.current.length !== snap.nodes.length ||
      nodesRef.current.some((n) => {
        const prev = snap.nodes.find((p) => p.id === n.id)
        return !prev || prev.position.x !== n.position.x || prev.position.y !== n.position.y
      })
    if (!changed) return
    setHistory((h) => recordHistory(h, snap))
  }, [])

  // ── Node selection ────────────────────────────────────────────────────────
  const onNodeClick = useCallback((_: React.MouseEvent, node: FlowNode) => {
    setSelectedNodeId(node.id)
    setQuickAdd(null)
    setNodeMenu(null)
  }, [])

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null)
    setQuickAdd(null)
    setNodeMenu(null)
  }, [])

  // ── Config editing ────────────────────────────────────────────────────────
  const updateNodeConfig = useCallback(
    (key: string, value: unknown) => {
      if (!selectedNodeId) return
      // Tagged so a burst of keystrokes on the same field coalesces into one
      // undo entry (restoring the pre-edit value), instead of one per change.
      recordPre(`cfg:${selectedNodeId}:${key}`)
      setNodes((ns) =>
        ns.map((n) =>
          n.id === selectedNodeId
            ? {
                ...n,
                data: { ...n.data, config: { ...(n.data as NodeData).config, [key]: value } },
              }
            : n,
        ),
      )
    },
    [selectedNodeId, setNodes, recordPre],
  )

  // ── Add block ─────────────────────────────────────────────────────────────
  // A block placed at a point (a drop, the quick-add list) is centred on it once
  // measured (takeMeasured); one added with no point keeps the stagger.
  const centerPending = useRef(new Set<string>())
  const addBlock = useCallback(
    (def: models.BlockDef, position?: { x: number; y: number }) => {
      recordPre()
      const id = randId()
      if (position) centerPending.current.add(id)
      const pos = position ?? { x: 80 + nodes.length * 30, y: 80 + nodes.length * 20 }
      setNodes((ns) => [
        ...ns,
        {
          id,
          type: 'block' as const,
          position: pos,
          data: {
            blockType: def.id,
            config: defaultConfig(def),
            label: def.label,
          },
        },
      ])
      setSelectedNodeId(id)
    },
    [nodes.length, setNodes, recordPre],
  )

  // Drag-drop from palette onto canvas
  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      const blockType = e.dataTransfer.getData('blockType')
      const def = defMap.get(blockType)
      if (!def) return
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      addBlock(def, position)
    },
    [defMap, screenToFlowPosition, addBlock],
  )

  // ── New graph ─────────────────────────────────────────────────────────────
  const handleNew = useCallback(() => {
    setNodes([])
    setEdges([])
    setGraphId('')
    setGraphName('New graph')
    setGraphEnabled(false)
    setCreatedAt(0)
    setSelectedNodeId(null)
    setSavedSig(graphSignature({ name: 'New graph', enabled: false }, [], []))
    setHistory(emptyHistory())
  }, [setNodes, setEdges])

  // ── Save ──────────────────────────────────────────────────────────────────
  // Returns null when the save failed. The store records the message and the
  // toolbar renders it, so there's nothing to report here — but the graph must
  // not be marked clean, and callers must not act on a phantom id.
  const handleSave = useCallback(async (): Promise<string | null> => {
    setSaving(true)
    try {
      const graph = flowToGraph(
        { id: graphId ?? '', name: graphName || 'Untitled', enabled: graphEnabled, createdAt },
        nodes,
        edges,
      )
      const saved = await onSave(graph)
      setGraphId(saved.id)
      setCreatedAt(saved.createdAt)
      setSavedSig(graphSignature({ name: graphName, enabled: graphEnabled }, nodes, edges))
      return saved.id
    } catch {
      return null
    } finally {
      setSaving(false)
    }
  }, [graphId, graphName, graphEnabled, createdAt, nodes, edges, onSave])

  // ── Run now ───────────────────────────────────────────────────────────────
  const handleRun = useCallback(async () => {
    const id = await handleSave()
    if (!id) return
    // The call returns when the whole graph has finished, minutes for a block
    // that stops the server, so say that it is under way.
    showRunStatus(RUN_RUNNING)
    withdrawToast(scheduleRunToastKey(id))
    try {
      showRunStatus(runOutcome(await onRun(id)))
    } catch {
      /* store surfaces the error in the toolbar */
      showRunStatus(null)
    }
  }, [handleSave, onRun, showRunStatus])

  // A run uses the saved graph (the backend runs it by id), so running unsaved
  // changes means saving them. That is the user's call, not a side effect of
  // run: a dirty graph asks first, a clean one runs straight away.
  const [runAsk, setRunAsk] = useState(false)
  const requestRun = useCallback(() => {
    if (dirtyRef.current) setRunAsk(true)
    else void handleRun()
  }, [handleRun])

  // ── Delete selected nodes + their edges ───────────────────────────────────
  const handleDeleteSelected = useCallback(() => {
    const selectedIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id))
    const hasSelectedEdges = edges.some((e) => e.selected)
    if (selectedIds.size === 0 && !hasSelectedEdges) return
    recordPre()
    setNodes((ns) => ns.filter((n) => !n.selected))
    setEdges((es) =>
      es.filter((e) => !e.selected && !selectedIds.has(e.source) && !selectedIds.has(e.target)),
    )
    setSelectedNodeId(null)
  }, [nodes, edges, setNodes, setEdges, recordPre])

  // ── Copy, cut, paste, duplicate (#128) ────────────────────────────────────
  // Where a paste lands, in flow coordinates: under the pointer when it is over
  // the canvas, since that is where the user is looking, and at the canvas
  // centre otherwise. A click on a menu leaves the pointer on the toolbar, which
  // is off the canvas, so the centre is what a menu-driven paste uses.
  const canvasAnchor = useCallback(
    (followCursor: boolean) => {
      const rect = canvasWrapperRef.current?.getBoundingClientRect()
      if (!rect) return null
      const { x, y } = mousePos.current
      const over =
        followCursor && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      return screenToFlowPosition(
        over ? { x, y } : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      )
    },
    [screenToFlowPosition],
  )

  // Adds the copy as one history entry and makes it the selection, so the next
  // Delete, cut or Ctrl+D acts on what was just placed rather than on whatever
  // was selected before.
  const placeSlice = useCallback(
    (slice: ClipboardSlice, delta: { x: number; y: number }) => {
      const placed = instantiateSlice(slice, delta)
      recordPre()
      setNodes((ns) => [
        ...ns.map((n) => (n.selected ? { ...n, selected: false } : n)),
        ...placed.nodes,
      ])
      setEdges((es) => [
        ...es.map((e) => (e.selected ? { ...e, selected: false } : e)),
        ...placed.edges,
      ])
      setSelectedNodeId(placed.nodes.length === 1 ? placed.nodes[0].id : null)
    },
    [setNodes, setEdges, recordPre],
  )

  // Each of these says whether it did anything, so the key handler only takes
  // the browser's own Ctrl+C or Ctrl+V when it had something to do.
  const copySelected = useCallback((): boolean => {
    const slice = captureSelection(nodesRef.current, edgesRef.current)
    if (!slice) return false
    writeClipboard(slice)
    return true
  }, [])

  // Copy, then the ordinary delete, which is what records the undo entry.
  const cutSelected = useCallback((): boolean => {
    if (!copySelected()) return false
    handleDeleteSelected()
    return true
  }, [copySelected, handleDeleteSelected])

  // `at` is a flow point to land on, for a menu that opened where the user
  // pointed: the pointer has moved off the canvas by the time a row is picked,
  // so the spot is the one the menu was opened at, not the pointer's now.
  const pasteClipboard = useCallback(
    (followCursor = false, at: { x: number; y: number } | null = null): boolean => {
      const slice = readClipboard()
      if (!slice) return false
      const anchor = at ?? canvasAnchor(followCursor)
      placeSlice(slice, pasteDelta(slice, anchor, pasteStep(anchor)))
      return true
    },
    [canvasAnchor, placeSlice],
  )

  // Copy and paste in one, without the clipboard: duplicating must not replace
  // what the user has copied.
  const duplicateSelected = useCallback((): boolean => {
    const slice = captureSelection(nodesRef.current, edgesRef.current)
    if (!slice) return false
    placeSlice(slice, pasteDelta(slice, null, 0))
    return true
  }, [placeSlice])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const action = clipboardAction(e, document.activeElement)
      if (!action) return
      const done =
        action === 'copy'
          ? copySelected()
          : action === 'cut'
            ? cutSelected()
            : action === 'paste'
              ? pasteClipboard(true)
              : duplicateSelected()
      if (done) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [copySelected, cutSelected, pasteClipboard, duplicateSelected])

  // ── Toggle enabled ────────────────────────────────────────────────────────
  const handleToggleEnabled = useCallback(async () => {
    if (!graphId) return
    const next = !graphEnabled
    setGraphEnabled(next)
    try {
      await onSetEnabled(graphId, next)
    } catch {
      // Revert the optimistic flip so the toggle doesn't misreport backend state.
      setGraphEnabled(!next)
    }
  }, [graphId, graphEnabled, onSetEnabled])

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!graphId) return
    try {
      await onDelete(graphId)
    } catch {
      // Keep the graph loaded — it still exists on the backend.
      return
    }
    handleNew()
  }, [graphId, onDelete, handleNew])

  // ── Derived state for config panel ────────────────────────────────────────
  const selectedNode = nodes.find((n) => n.id === selectedNodeId)
  const selectedDef = selectedNode
    ? defMap.get((selectedNode.data as NodeData).blockType)
    : undefined

  // Derive collapsed set from node configs so BlockNode can read it.
  const collapsed = useMemo(() => {
    const s = new Set<string>()
    for (const n of nodes) {
      if ((n.data as NodeData).config?._collapsed !== false) s.add(n.id)
    }
    return s
  }, [nodes])

  const onToggleCollapse = useCallback(
    (nodeId: string) => {
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id !== nodeId) return n
          const cur = (n.data as NodeData).config?._collapsed !== false
          return {
            ...n,
            data: { ...n.data, config: { ...(n.data as NodeData).config, _collapsed: !cur } },
          }
        }),
      )
      updateNodeInternals(nodeId)
    },
    [setNodes, updateNodeInternals],
  )

  // Static control-flow cycle analysis (cycles abort runs — warn the author).
  const { cycleNodes, cycleEdges } = useMemo(
    () => detectControlCycles(nodes, edges),
    [nodes, edges],
  )

  // ── Warnings ──────────────────────────────────────────────────────────────
  // Advice about the canvas, never a gate: it sits beside Save and neither a
  // save nor a run waits on it. The backend answers from each block's type and
  // config (a destination not chosen, a retention out of range) and, for a
  // stop, from the server's own state, so the ask is made when a block, its
  // config or what stops the server changes, or the server changes state
  // (RCON is confirmed once the server has started), not on every drag.
  const warnSig = useMemo(
    () =>
      JSON.stringify(
        nodes.map((n) => {
          const nd = n.data as NodeData
          const stops = nodeEffects(
            defMap.get(nd.blockType),
            nd.blockType,
            nd.config,
            isCommandHandleWired(n.id, edges),
          ).includes(NODE_EFFECT_STOPS_SERVER)
          return [n.id, nd.blockType, nd.config, stops]
        }),
      ),
    [nodes, edges, defMap],
  )
  const [warnings, setWarnings] = useState<models.GraphWarning[]>([])
  useEffect(() => {
    if (nodesRef.current.length === 0) {
      setWarnings([])
      return
    }
    let current = true
    // The metadata is irrelevant to a warning, so none of the graph's own state
    // is a dependency; the nodes and edges come from the refs, which are current
    // by now because their sync effects are declared above this one.
    const graph = flowToGraph(
      { id: '', name: '', enabled: false, createdAt: 0 },
      nodesRef.current,
      edgesRef.current,
    )
    askGraphWarnings(graph)
      .then((w) => {
        if (current) setWarnings(w)
      })
      .catch(() => {
        // Advice only: a failed ask leaves no warning rather than a banner, and
        // the next change to the blocks or the server asks again.
        if (current) setWarnings([])
      })
    return () => {
      current = false
    }
  }, [warnSig, serverState, askGraphWarnings])

  // The warnings in full go to a bubble; the toolbar says how many there are.
  // It outlives the editor, so closing the scheduler does not take the warning
  // with it, and it goes when the canvas no longer earns it. Reopening the same
  // canvas finds it already up and leaves it be, rather than counting a repeat.
  // One warning to a line, each led by the block it is about.
  const warningText = useMemo(
    () => warningRows(warnings, nodes).map(warningLine).join('\n'),
    [warnings, nodes],
  )
  const nodeAdvice = useMemo(() => warningsByNode(warnings), [warnings])
  const showWarningToast = useCallback(
    (force = false) => {
      if (!warningText) return
      const open = useNotificationsStore
        .getState()
        .toasts.some((t) => t.key === TOAST_WARNING && t.text === warningText)
      if (open && !force) return
      showToast(
        {
          key: TOAST_WARNING,
          category: 'warnings',
          tone: 'warn',
          title: 'Scheduler warning',
          text: warningText,
        },
        force,
      )
    },
    [warningText],
  )
  useEffect(() => {
    if (warningText) showWarningToast()
    else withdrawToast(TOAST_WARNING)
  }, [warningText, showWarningToast])

  // Wrap ReactFlow's own change handlers so a Delete-key removal (which never
  // goes through handleDeleteSelected) still records an undo entry.
  const handleNodesChange = useCallback(
    (changes: NodeChange<BlockFlowNode>[]) => {
      if (changes.some((c) => c.type === 'remove')) recordPre()
      onNodesChange(changes)
      if (centerPending.current.size > 0) {
        const sizes = takeMeasured(changes, centerPending.current)
        if (sizes.size > 0) setNodes((ns) => centerNodes(ns, sizes))
      }
    },
    [onNodesChange, recordPre, setNodes],
  )
  const handleEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]) => {
      if (changes.some((c) => c.type === 'remove')) recordPre()
      onEdgesChange(changes)
    },
    [onEdgesChange, recordPre],
  )

  const ctxValue = useMemo(
    () => ({
      blockDefs: defMap,
      edges,
      collapsed,
      onToggleCollapse,
      nodeRunState,
      nodeDowntimeMs,
      nodeWarning,
      nodeAdvice,
      nodeFailure,
      firedEdges,
      cycleNodes,
      cycleEdges,
      recordPre,
      curvedEdges,
      snapToGrid,
    }),
    [
      defMap,
      // aislop-ignore-next-line code-quality/duplicate-block -- a memo's dependency list mirrors the object it builds
      edges,
      collapsed,
      onToggleCollapse,
      nodeRunState,
      nodeDowntimeMs,
      nodeWarning,
      nodeAdvice,
      nodeFailure,
      firedEdges,
      cycleNodes,
      cycleEdges,
      recordPre,
      curvedEdges,
      snapToGrid,
    ],
  )

  // ── Toolbar handlers ──────────────────────────────────────────────────────
  // The quick-add list from the toolbar's add button: opened under the button,
  // adding at the middle of the canvas, since a click on the bar has no canvas
  // position of its own the way a right-click or Tab does.
  // A second press closes it, as the bar's other menus do.
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const openAddMenu = useCallback(
    (at: { x: number; y: number }) => {
      setNodeMenu(null)
      setQuickAdd((cur) =>
        cur ? null : { screen: at, flow: canvasAnchor(false) ?? screenToFlowPosition(at) },
      )
    },
    [canvasAnchor, screenToFlowPosition],
  )

  // A warning's row in the toolbar list: select that block, open its panel, and
  // bring it into view. No more zoom than the canvas has now when it is already
  // close, and never past 1, so a lone block is not blown up to fill the pane.
  const revealNode = useCallback(
    (id: string) => {
      setNodes((ns) =>
        ns.map((n) => (!!n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })),
      )
      setSelectedNodeId(id)
      void fitView({ nodes: [{ id }], maxZoom: 1, padding: 0.6, duration: 300 })
    },
    [setNodes, fitView],
  )

  // Selection is view state, not an edit, so it records no history entry. The
  // two arrays go through the same pure helper, each against an empty other.
  const selectNodes = useCallback(
    (spec: SelectionSpec) => {
      setNodes((ns) => applySelection(ns, [], spec).nodes)
      setEdges((es) => applySelection([], es, spec).edges)
    },
    [setNodes, setEdges],
  )

  // The Edit menu's actions, shared by the toolbar's menu and the node's
  // right-click menu; the latter swaps in a paste that lands where it opened.
  const editActions: EditMenuActions = {
    undo: doUndo,
    redo: doRedo,
    cut: cutSelected,
    copy: copySelected,
    duplicate: duplicateSelected,
    paste: () => pasteClipboard(false),
    deleteSelected: handleDeleteSelected,
    select: selectNodes,
  }
  const nodeMenuAt = nodeMenu?.flow ?? null
  const nodeMenuRows = editMenuRows(
    editMenuState({
      nodes,
      edges,
      defMap,
      canUndo: canUndo(history),
      canRedo: canRedo(history),
    }),
    { ...editActions, paste: () => pasteClipboard(false, nodeMenuAt) },
  )

  // Save as copy: the canvas as it is now goes to a new graph (a blank id is
  // what makes the backend mint one), switched off so the copy does not fire
  // beside the original, and the editor moves onto it. Unsaved edits travel with
  // the copy and the original keeps its last save, which is what a save-as does
  // anywhere else.
  const handleDuplicateGraph = useCallback(async () => {
    setSaving(true)
    try {
      const copy = flowToGraph(
        { id: '', name: `${graphName || 'Untitled'} copy`, enabled: false, createdAt: 0 },
        nodes,
        edges,
      )
      loadGraph(await onSave(copy))
    } catch {
      /* the store records the failure and the toolbar shows it */
    } finally {
      setSaving(false)
    }
  }, [graphName, nodes, edges, onSave, loadGraph])

  return (
    <SchedulerCtx.Provider value={ctxValue}>
      {/* lazy-panel-in: this whole editor is a Suspense chunk, so it lands in
          one frame — fade it in rather than snapping the canvas over the
          tile's surface (style.css). */}
      <div className="lazy-panel-in flex h-full flex-col">
        {/* ── Toolbar ──────────────────────────────────────────────────── */}
        <Toolbar
          graphs={graphs}
          graphId={graphId}
          graphName={graphName}
          graphEnabled={graphEnabled}
          dirty={dirty}
          saving={saving}
          nodes={nodes}
          edges={edges}
          defMap={defMap}
          canUndo={canUndo(history)}
          canRedo={canRedo(history)}
          runStatus={runStatus}
          schedulerError={schedulerError}
          warnings={warnings}
          onLoadGraph={(g) => confirm.guard(() => loadGraph(g))}
          onNewGraph={() => confirm.guard(handleNew)}
          onAdd={openAddMenu}
          view={{
            curvedEdges,
            onToggleCurvedEdges: () =>
              // Swallowed: `update` reverts the flag itself on a refused write
              // and the settings modal shows why, as for the palette.
              updateSettings({ schedulerCurvedEdges: !curvedEdges }).catch(() => {}),
            snapToGrid,
            onToggleSnapToGrid: () =>
              updateSettings({ schedulerSnapToGrid: !snapToGrid }).catch(() => {}),
          }}
          addOpen={quickAdd !== null}
          addButtonRef={addButtonRef}
          edit={editActions}
          onToggleEnabled={handleToggleEnabled}
          onRun={requestRun}
          onSave={handleSave}
          onRename={setGraphName}
          onDuplicateGraph={handleDuplicateGraph}
          onDeleteGraph={handleDelete}
          onErrorClick={() => {
            showErrorToast(true)
            clearSchedulerError()
          }}
          onRunStatusClick={(status) => {
            reopenRunToast(status)
            showRunStatus(null)
          }}
          onSelectNode={revealNode}
          onWarningsClick={() => showWarningToast(true)}
        />

        {/* ── Main content ─────────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">
          {/* Block palette */}
          <BlockPalette blockDefs={blockDefs} onAdd={(def) => addBlock(def)} />

          {/* ReactFlow canvas, with the node panel floating over its right edge.
              The panel is a sibling of the canvas wrapper rather than a child,
              so the wrapper's capture-phase right-click (quick-add) and its drop
              target stop at the canvas, as they did when the panel was a column. */}
          <div
            className={`node-panel-host relative flex-1 ${selectedNode ? 'node-panel-open' : ''}`}
          >
            <div ref={canvasWrapperRef} className="h-full" onDrop={onDrop} onDragOver={onDragOver}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={handleNodesChange}
                onEdgesChange={handleEdgesChange}
                onConnect={onConnect}
                onNodeClick={onNodeClick}
                onNodeDragStart={onNodeDragStart}
                onNodeDragStop={onNodeDragStop}
                onPaneClick={onPaneClick}
                isValidConnection={isValidConnection}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                deleteKeyCode={DELETE_KEYS}
                panOnDrag={[1, 2]}
                selectionOnDrag
                snapToGrid={snapToGrid}
                snapGrid={SNAP_GRID}
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={GRID_GAP}
                  size={GRID_DOT_SIZE}
                  offset={GRID_DOT_OFFSET}
                />
                <Controls showInteractive={false} />
                <MiniMap
                  // eslint-disable-next-line no-restricted-syntax -- overrides xyflow's default 10px Panel offset; a stylesheet className would race the library's own CSS specificity
                  style={{ bottom: 8, right: 8 }}
                  nodeColor={(n) => {
                    const bt = (n.data as NodeData | undefined)?.blockType ?? ''
                    const category = bt.split('.')[0]
                    return CATEGORY_COLOR[category] ?? CATEGORY_COLOR.notify
                  }}
                />
              </ReactFlow>
            </div>
            <PaletteToggle />

            {/* Node config / data panel: floats over the canvas, never resizes it */}
            <NodePanel
              node={selectedNode}
              def={selectedDef}
              edges={edges as FlowEdge[]}
              tab={panelTab}
              onTab={setPanelTab}
              onChange={updateNodeConfig}
              warnings={selectedNode ? nodeAdvice.get(selectedNode.id) : undefined}
              failure={selectedNode ? nodeFailure.get(selectedNode.id) : undefined}
              getGraph={() =>
                flowToGraph(
                  { id: graphId ?? '', name: graphName, enabled: graphEnabled, createdAt },
                  nodes,
                  edges,
                )
              }
              onPreview={onPreviewNode}
            />
          </div>
        </div>
      </div>

      <NodeMenuHost request={nodeMenu} rows={nodeMenuRows} onClose={() => setNodeMenu(null)} />

      <QuickAddHost
        request={quickAdd}
        blockDefs={blockDefs}
        onPick={(def, flow) => {
          addBlock(def, flow)
          setQuickAdd(null)
        }}
        onClose={() => setQuickAdd(null)}
        trigger={addButtonRef}
      />

      <CloseConfirmDialog
        open={confirm.pending}
        saving={saving}
        onCancel={confirm.cancel}
        onDiscard={() => {
          // Mark clean first: the close path re-enters the close guard, which
          // reads dirtyRef and would otherwise put the dialog straight back.
          setSavedSig(graphSignature({ name: graphName, enabled: graphEnabled }, nodes, edges))
          confirm.proceed()
        }}
        onSaveAndContinue={async () => {
          // null means the save failed. The store has recorded the message and
          // the toolbar renders it, so drop the pending action and leave the
          // graph loaded rather than continuing past a failure (#124).
          if ((await handleSave()) === null) {
            confirm.cancel()
            return
          }
          confirm.proceed()
        }}
      />
      <CloseConfirmDialog
        open={runAsk}
        saving={saving}
        body="Run uses the saved graph. Save your changes and run it?"
        confirmLabel="Save & run"
        onCancel={() => setRunAsk(false)}
        onSaveAndContinue={() => {
          // handleRun saves first and stops there if the save fails, with
          // the reason in the toolbar, as it always has.
          setRunAsk(false)
          void handleRun()
        }}
      />
    </SchedulerCtx.Provider>
  )
}
