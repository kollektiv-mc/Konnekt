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
  MessageCircleWarning,
  SquareActivity,
  SquareChevronRight,
  UsersRound,
  Workflow,
  // Sidebar and tile chrome.
  ChevronDown,
  CircleCheck,
  CircleX,
  Maximize2,
  Minimize2,
  Pencil,
  Settings,
  SlidersHorizontal,
  X,
  // Window controls, in the app's own title bar. Deliberately not Maximize2 /
  // Minimize2, which the tile header already uses: the two bars sit one above
  // the other and the same glyph in both would say the window and the tile do
  // the same thing. Square / Copy are the chrome shapes every desktop draws
  // there, and Minus is the one glyph both conventions agree on.
  Copy,
  Minus,
  Square,
} from 'lucide-react'
