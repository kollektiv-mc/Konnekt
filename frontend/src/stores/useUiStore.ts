import { create } from 'zustand'

interface UiStore {
  // Fullscreen request raised by the navbar; consumed + cleared by Dashboard.
  maximizeRequest: { id: string; rect: DOMRect | null } | null
  requestMaximize: (id: string, rect: DOMRect | null) => void
  clearMaximizeRequest: () => void
  // Bumped to ask Dashboard to close any open fullscreen (e.g. utility-tile click).
  closeRequest: number
  requestCloseMaximize: () => void
  // Which module is mid-drag, so Dashboard can size the RGL drop placeholder.
  draggingTileId: string | null
  setDraggingTileId: (id: string | null) => void
  // Tile to briefly glow green on the canvas (utility-tile click).
  flashTileId: string | null
  flashTile: (id: string) => void
  // Set by the maximized tile to veto a close (e.g. unsaved changes). Returning
  // true blocks the close and takes over showing its own confirm UI.
  closeGuard: (() => boolean) | null
  setCloseGuard: (fn: (() => boolean) | null) => void

  // The server manager, and the sidebar's disconnect confirm.
  //
  // Held here rather than in the sidebar that opens them because both render at
  // app level: a `fixed` overlay inside <aside> loses to the maximized-tile
  // overlay inside <main>, which carries the same z-50 and comes later in the
  // document. SettingsModal only sits on top because App renders it after
  // <main>, and these now do the same.
  serverManagerOpen: boolean
  /** A config id, or the add-server sentinel. */
  serverManagerSelection: string
  openServerManager: (selection: string) => void
  closeServerManager: () => void
  /** Id of the server whose disconnect is awaiting confirmation. */
  pendingDisconnect: string | null
  setPendingDisconnect: (id: string | null) => void
}

export const useUiStore = create<UiStore>((set) => ({
  maximizeRequest: null,
  requestMaximize: (id, rect) => set({ maximizeRequest: { id, rect } }),
  clearMaximizeRequest: () => set({ maximizeRequest: null }),

  closeRequest: 0,
  requestCloseMaximize: () => set((s) => ({ closeRequest: s.closeRequest + 1 })),

  draggingTileId: null,
  setDraggingTileId: (id) => set({ draggingTileId: id }),

  flashTileId: null,
  flashTile: (id) => {
    set({ flashTileId: id })
    setTimeout(() => {
      set((s) => (s.flashTileId === id ? { flashTileId: null } : s))
    }, 1200)
  },

  closeGuard: null,
  setCloseGuard: (fn) => set({ closeGuard: fn }),

  serverManagerOpen: false,
  serverManagerSelection: '',
  openServerManager: (selection) =>
    set({ serverManagerOpen: true, serverManagerSelection: selection }),
  closeServerManager: () => set({ serverManagerOpen: false }),

  pendingDisconnect: null,
  setPendingDisconnect: (id) => set({ pendingDisconnect: id }),
}))
