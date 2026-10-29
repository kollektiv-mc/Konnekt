/**
 * The only module in the app that imports `lucide-react`.
 *
 * Two reasons it is a seam rather than a convention. The dependency ships 1600+
 * icons and tree-shakes to nothing unused (`sideEffects: false`), so the entry
 * chunk only pays for what is re-exported here — which makes this file the one
 * place to read when `pnpm check-bundle` moves. And every render site takes the
 * icon as a component prop, so swapping the icon set later is an edit to this
 * file, not a sweep across the tree.
 *
 * Adding an icon: find it on https://lucide.dev/icons, add its PascalCase name
 * to the import and the export below. Do not import `lucide-react` anywhere
 * else, and do not hand-copy its SVG into a component — the package's path data
 * is the same data lucide.dev serves (verified against it when this landed), so
 * a transcribed copy is a silent fork.
 *
 * lucide-react is ISC licensed (c) Lucide Icons and Contributors.
 */
export type { LucideIcon } from 'lucide-react'

export {
  // Tile icons — one per entry in `tiles/registry.ts`.
  Blocks,
  Command,
  Database,
  Earth,
  FileSliders,
  Gauge,
  LayoutDashboard,
  MessageCircleWarning,
  SquareChevronRight,
  UsersRound,
  Workflow,
  // Sidebar and tile chrome.
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  Ellipsis,
  Maximize2,
  Minimize2,
  Pencil,
  Settings,
  X,
  // Commands tile: the button grid, the maximized library, and link state.
  CopyPlus,
  GripVertical,
  Link2,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
  // The scheduler's blocks: a node that stops the server is marked with Power,
  // kept apart from TriangleAlert, which a node with a warning or a failed run
  // wears. One shape for two meanings was read as "this is a problem".
  Power,
  // Window controls, in the app's own title bar. Deliberately not Maximize2 /
  // Minimize2, which the tile header already uses: the two bars sit one above
  // the other and the same glyph in both would say the window and the tile do
  // the same thing. Square / Copy are the chrome shapes every desktop draws
  // there, and Minus is the one glyph both conventions agree on.
  Copy,
  Minus,
  Square,
  // Menu and form chrome that used to be literal glyphs (#367): the sort
  // buttons' up-down arrow, and the JVM mode toggle's back arrow.
  ArrowLeft,
  ArrowUpDown,
  // The in-app notification bubbles: one glyph per tone, and the update one.
  CircleArrowUp,
  Info,
  // The scheduler's block-browser toggle: a shut box while the browser is
  // closed, the same box opened while it is out. Lucide's one closed/open pair.
  Package,
  PackageOpen,
  // The Config tile's canvas face: read server.properties from disk again.
  RotateCw,
} from 'lucide-react'
