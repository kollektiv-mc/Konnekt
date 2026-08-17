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
import { CATEGORY_COLOR } from './blockMeta'
import { SchedulerCtx, type NodeRunState } from './schedulerContext'
import { BlockNode } from './BlockNode'
import { AnimatedEdge } from './AnimatedEdge'
import { BlockPalette } from './BlockPalette'
import { NodeConfigPanel } from './NodeConfigPanel'
import { NodeDataPanel } from './NodeDataPanel'
import { QuickAddMenu } from './QuickAddMenu'
import { Popover } from '../../../components/ui/Popover'
import { usePopover } from '../../../hooks/usePopover'
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
import { CloseConfirmDialog } from './CloseConfirmDialog'
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
import { EVENTS } from '../../../lib/constants'
import { useUiStore } from '../../../stores/useUiStore'
import { useSchedulerStore } from '../../../stores/useSchedulerStore'
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
}

const RUN_CLEAR_MS = 2400

const nodeTypes = { block: BlockNode }
const edgeTypes = { smoothstep: AnimatedEdge }

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
  const { screenToFlowPosition } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()

  const defMap = useMemo(() => new Map(blockDefs.map((d) => [d.id, d])), [blockDefs])

  // ── Graph metadata ────────────────────────────────────────────────────────
  const [graphId, setGraphId] = useState<string | null>(null)
  const [graphName, setGraphName] = useState('')
  const [graphEnabled, setGraphEnabled] = useState(false)
  const [createdAt, setCreatedAt] = useState(0)
  const [nameEditing, setNameEditing] = useState(false)
  const graphMenu = usePopover()

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
  const [runStatus, setRunStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const runStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Read straight from the store rather than threading another prop through:
  // the graph data itself still arrives via props from the tile's hook.
  const schedulerError = useSchedulerStore((s) => s.error)
  const clearSchedulerError = useSchedulerStore((s) => s.clearError)

  // ── Unsaved-changes guard ─────────────────────────────────────────────────
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  // State (not a ref) so changing it — on load/save/discard — reliably
  // invalidates the `dirty` memo below.
  const [savedSig, setSavedSig] = useState('')
  const dirty = useMemo(
    () => graphSignature({ name: graphName, enabled: graphEnabled }, nodes, edges) !== savedSig,
    [graphName, graphEnabled, nodes, edges, savedSig],
  )
  const dirtyRef = useRef(false)
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  // Veto a Dashboard-initiated close (Escape / backdrop / restore button /
  // navbar) while there are unsaved changes, in favor of our own confirm
  // dialog. Registered only while this editor is mounted (i.e. maximized).
  const setCloseGuard = useUiStore((s) => s.setCloseGuard)
  useEffect(() => {
    setCloseGuard(() => {
      if (!dirtyRef.current) return false
      setShowCloseConfirm(true)
      return true
    })
    return () => setCloseGuard(null)
  }, [setCloseGuard])

  // ── Live run highlighting (driven by schedule:* events) ───────────────────
  const [nodeRunState, setNodeRunState] = useState<Map<string, NodeRunState>>(new Map())
  const [firedEdges, setFiredEdges] = useState<Set<string>>(new Set())
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Refs so the event handlers (registered once) read current graph + edges.
  const graphIdRef = useRef<string | null>(null)
  const edgesRef = useRef<FlowEdge[]>([])

  const [quickAdd, setQuickAdd] = useState<{
    screen: { x: number; y: number }
    flow: { x: number; y: number }
  } | null>(null)
  const canvasWrapperRef = useRef<HTMLDivElement>(null)
  const mousePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  // Track cursor so Tab opens the quick-add menu at the pointer, not canvas center.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      mousePos.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('mousemove', handler)
    return () => window.removeEventListener('mousemove', handler)
  }, [])

  const showRunStatus = useCallback((msg: string) => {
    setRunStatus(msg)
    if (runStatusTimer.current) clearTimeout(runStatusTimer.current)
    runStatusTimer.current = setTimeout(() => setRunStatus(null), 4000)
  }, [])

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

    const offRunStart = EventsOn(EVENTS.SCHEDULE_RUN_STARTED, (p: RunEvt) => {
      if (p.graphId !== graphIdRef.current) return
      if (clearTimer.current) clearTimeout(clearTimer.current)
      reset()
    })
    const offNodeStart = EventsOn(EVENTS.SCHEDULE_NODE_STARTED, (p: NodeEvt) => {
      if (p.graphId !== graphIdRef.current) return
      setNodeRunState((m) => new Map(m).set(p.nodeId, 'running'))
    })
    const offNodeFin = EventsOn(EVENTS.SCHEDULE_NODE_FINISHED, (p: NodeEvt) => {
      if (p.graphId !== graphIdRef.current) return
      setNodeRunState((m) => new Map(m).set(p.nodeId, p.status === 'failed' ? 'failed' : 'success'))
      const fired = `ctrl:${p.firedPort ?? ''}`
      setFiredEdges((s) => {
        const next = new Set(s)
        for (const e of edgesRef.current) {
          if (e.source === p.nodeId && (e.sourceHandle ?? '') === fired) next.add(e.id)
        }
        return next
      })
    })
    const offRunFin = EventsOn(EVENTS.SCHEDULE_RUN_FINISHED, (p: RunEvt) => {
      if (p.graphId !== graphIdRef.current) return
      if (clearTimer.current) clearTimeout(clearTimer.current)
      clearTimer.current = setTimeout(reset, RUN_CLEAR_MS)
    })

    return () => {
      offRunStart()
      offNodeStart()
      offNodeFin()
      offRunFin()
      if (clearTimer.current) clearTimeout(clearTimer.current)
    }
  }, [])

  // ── Right-click on canvas → open quick-add ───────────────────────────────
  // Capture-phase native listener fires before WebView2 can show its native menu.
  useEffect(() => {
    const el = canvasWrapperRef.current
    if (!el) return
    const handler = (e: MouseEvent) => {
      e.preventDefault()
      const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      setQuickAdd({ screen: { x: e.clientX, y: e.clientY }, flow })
    }
    el.addEventListener('contextmenu', handler, true)
    return () => el.removeEventListener('contextmenu', handler, true)
  }, [screenToFlowPosition])

  // ── Tab key → open quick-add at cursor position ──────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const tag = (document.activeElement as HTMLElement | null)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      e.preventDefault()
      const { x: sx, y: sy } = mousePos.current
      const flow = screenToFlowPosition({ x: sx, y: sy })
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
      setFiredEdges(new Set())
      setSavedSig(graphSignature({ name: g.name, enabled: g.enabled }, animNodes, animEdges))
      setHistory(emptyHistory())
      // Re-measure handle positions after the maximize animation (panel animates
      // for 180ms). ReactFlow's initial measurement runs while the panel ancestor
      // may still have scale < 1, producing stale edge endpoints. Waiting 220ms
      // ensures getBoundingClientRect returns settled coordinates.
      const ids = ns.map((n) => n.id)
      setTimeout(() => updateNodeInternals(ids), 220)
    },
    [defMap, setNodes, setEdges, updateNodeInternals],
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
            type: 'smoothstep',
            style: isData ? { strokeDasharray: '4 2', stroke: '#60a5fa' } : undefined,
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
  }, [])

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null)
    setQuickAdd(null)
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
  const addBlock = useCallback(
    (def: models.BlockDef, position?: { x: number; y: number }) => {
      recordPre()
      const id = randId()
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
    try {
      const rec = await onRun(id)
      if (rec.status === 'skipped') {
        showRunStatus('already running')
      } else if (rec.status === 'failed') {
        showRunStatus(`failed: ${rec.error || 'unknown error'}`)
      } else {
        showRunStatus(`done (${rec.nodes?.length ?? 0} nodes)`)
      }
    } catch {
      /* store surfaces the error in the toolbar */
    }
  }, [handleSave, onRun, showRunStatus])

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

  // Wrap ReactFlow's own change handlers so a Delete-key removal (which never
  // goes through handleDeleteSelected) still records an undo entry.
  const handleNodesChange = useCallback(
    (changes: NodeChange<BlockFlowNode>[]) => {
      if (changes.some((c) => c.type === 'remove')) recordPre()
      onNodesChange(changes)
    },
    [onNodesChange, recordPre],
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
      firedEdges,
      cycleNodes,
      cycleEdges,
    }),
    [defMap, edges, collapsed, onToggleCollapse, nodeRunState, firedEdges, cycleNodes, cycleEdges],
  )

  // ── Toolbar button className helper ───────────────────────────────────────
  function btnClass(active = false, danger = false): string {
    const base = 'cursor-pointer rounded border-hairline px-2 py-0.5 text-[11px] font-mono'
    const borderClass = danger ? 'border-[#ef4444]' : 'border-border-subtle'
    if (active) return `${base} ${borderClass} bg-accent text-black`
    if (danger) return `${base} ${borderClass} bg-transparent text-[#ef4444]`
    return `${base} ${borderClass} bg-surface text-text-muted`
  }

  return (
    <SchedulerCtx.Provider value={ctxValue}>
      <div className="flex h-full flex-col">
        {/* ── Toolbar ──────────────────────────────────────────────────── */}
        <div className="border-border-subtle bg-surface border-b-hairline flex shrink-0 flex-wrap items-center gap-2 px-3 py-1.5">
          {/* Graph selector */}
          <div className="relative shrink-0">
            <button
              onClick={graphMenu.toggle}
              className={`border-border-subtle text-text-primary border-hairline flex max-w-[160px] shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap transition-colors ${
                graphMenu.open ? 'bg-hover' : 'bg-canvas'
              }`}
            >
              <span className="text-text-faint text-[10px]">☰</span>
              <span className="truncate">
                {graphs.length === 0
                  ? '— no graphs —'
                  : graphId === ''
                    ? '— new graph —'
                    : (graphs.find((g) => g.id === graphId)?.name ?? graphId ?? '— new graph —')}
              </span>
            </button>

            <Popover
              open={graphMenu.open}
              onClose={graphMenu.close}
              width={180}
              maxHeight={280}
              align="left"
            >
              {graphs.length === 0 && (
                <div className="text-text-faint px-3 py-1.5 font-mono text-xs">— no graphs —</div>
              )}
              {graphs.map((g) => {
                const active = g.id === graphId
                return (
                  <button
                    key={g.id}
                    onClick={() => {
                      loadGraph(g)
                      graphMenu.close()
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs transition-colors ${
                      active
                        ? 'text-accent bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'
                        : 'text-text-primary bg-transparent'
                    }`}
                    onMouseEnter={(e) => {
                      if (!active)
                        (e.currentTarget as HTMLElement).style.background = 'var(--hover-surface)'
                    }}
                    onMouseLeave={(e) => {
                      if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'
                    }}
                  >
                    <span
                      className={`text-accent w-3 shrink-0 ${active ? 'opacity-100' : 'opacity-0'}`}
                    >
                      ✓
                    </span>
                    <span className="min-w-0 truncate">{g.name || g.id}</span>
                  </button>
                )
              })}
              {graphId === '' && (
                <div className="text-accent flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs">
                  <span className="w-3">✓</span>— new graph —
                </div>
              )}
            </Popover>
          </div>

          {/* Graph name */}
          {nameEditing ? (
            <input
              autoFocus
              value={graphName}
              onChange={(e) => setGraphName(e.target.value)}
              onBlur={() => setNameEditing(false)}
              onKeyDown={(e) => e.key === 'Enter' && setNameEditing(false)}
              className="bg-canvas border-accent text-text-primary border-hairline w-[140px] rounded px-1.5 py-0.5 font-mono text-[11px] outline-none"
            />
          ) : (
            <span
              onClick={() => setNameEditing(true)}
              className="text-text-muted border-border-subtle border-b-hairline flex min-w-[60px] cursor-text items-center gap-1.5 border-dashed font-mono text-[11px]"
              title="Click to rename"
            >
              {graphName || 'Untitled'}
              {dirty && (
                <span
                  className="bg-accent h-1.5 w-1.5 shrink-0 rounded-full"
                  title="Unsaved changes"
                />
              )}
            </span>
          )}

          <div className="bg-border-subtle h-4 w-[0.5px]" />

          <button className={btnClass()} onClick={handleNew}>
            new
          </button>

          {graphId && (
            <button className={btnClass(graphEnabled)} onClick={handleToggleEnabled}>
              {graphEnabled ? '[on]' : '[off]'}
            </button>
          )}

          <button
            className={`${btnClass()} ${!canUndo(history) ? 'opacity-50' : ''}`}
            onClick={doUndo}
            disabled={!canUndo(history)}
            title="Undo (Ctrl+Z)"
          >
            undo
          </button>
          <button
            className={`${btnClass()} ${!canRedo(history) ? 'opacity-50' : ''}`}
            onClick={doRedo}
            disabled={!canRedo(history)}
            title="Redo (Ctrl+Shift+Z)"
          >
            redo
          </button>

          <div className="flex-1" />

          {/* IPC errors take the transient status slot and stay until dismissed. */}
          {schedulerError ? (
            <button
              type="button"
              onClick={clearSchedulerError}
              className="text-danger font-mono text-[10px]"
              title={`${schedulerError} — click to dismiss`}
            >
              scheduler error
            </button>
          ) : (
            runStatus && <span className="text-text-faint font-mono text-[10px]">{runStatus}</span>
          )}

          {(() => {
            const selCount =
              nodes.filter((n) => n.selected).length + edges.filter((e) => e.selected).length
            return selCount > 0 ? (
              <button className={btnClass(false, true)} onClick={handleDeleteSelected}>
                del {selCount}
              </button>
            ) : null
          })()}

          {graphId && (
            <button className={btnClass()} onClick={handleRun}>
              run
            </button>
          )}

          <button
            className={`${btnClass()} ${saving ? 'opacity-50' : ''}`}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '...' : 'save'}
          </button>

          {graphId && (
            <button className={btnClass(false, true)} onClick={handleDelete}>
              del graph
            </button>
          )}
        </div>

        {/* ── Main content ─────────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">
          {/* Block palette */}
          <BlockPalette blockDefs={blockDefs} onAdd={(def) => addBlock(def)} />

          {/* ReactFlow canvas */}
          <div ref={canvasWrapperRef} className="flex-1" onDrop={onDrop} onDragOver={onDragOver}>
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
              deleteKeyCode="Delete"
              panOnDrag={[1, 2]}
              selectionOnDrag
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
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

          {/* Node config / data panel */}
          {selectedNode && (
            <div className="border-border-subtle bg-canvas border-l-hairline flex w-56 shrink-0 flex-col overflow-y-auto">
              {/* Tabs */}
              <div className="border-border-subtle border-b-hairline flex shrink-0">
                {(['config', 'data'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setPanelTab(tab)}
                    className={`flex-1 cursor-pointer border-b py-1.5 font-mono text-xs ${
                      panelTab === tab
                        ? 'bg-surface text-text-primary border-accent'
                        : 'text-text-faint border-transparent bg-transparent'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {panelTab === 'config' ? (
                <NodeConfigPanel
                  nodeId={selectedNode.id}
                  data={selectedNode.data as NodeData}
                  def={selectedDef}
                  edges={edges as FlowEdge[]}
                  onChange={updateNodeConfig}
                />
              ) : (
                <NodeDataPanel
                  graph={flowToGraph(
                    { id: graphId ?? '', name: graphName, enabled: graphEnabled, createdAt },
                    nodes,
                    edges,
                  )}
                  nodeId={selectedNode.id}
                  onPreview={onPreviewNode}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {quickAdd && (
        <QuickAddMenu
          blockDefs={blockDefs}
          screenPos={quickAdd.screen}
          onPick={(def) => {
            addBlock(def, quickAdd.flow)
            setQuickAdd(null)
          }}
          onClose={() => setQuickAdd(null)}
        />
      )}

      {showCloseConfirm && (
        <CloseConfirmDialog
          saving={saving}
          onCancel={() => setShowCloseConfirm(false)}
          onDiscard={() => {
            setSavedSig(graphSignature({ name: graphName, enabled: graphEnabled }, nodes, edges))
            setShowCloseConfirm(false)
            useUiStore.getState().requestCloseMaximize()
          }}
          onSaveAndClose={async () => {
            await handleSave()
            setShowCloseConfirm(false)
            useUiStore.getState().requestCloseMaximize()
          }}
        />
      )}
    </SchedulerCtx.Provider>
  )
}
