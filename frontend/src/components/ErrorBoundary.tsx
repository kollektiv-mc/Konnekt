import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /**
   * What to render in place of a subtree that threw. The default fills the
   * viewport, which is right for the app-level boundary in `main.tsx` and
   * absurd anywhere smaller — the Overview panel wraps each summary card in
   * its own boundary so one failing tile summary does not blank the panel,
   * and passes a fallback that fits a card.
   *
   * A function receives the error, for a fallback that wants to show the
   * message or offer a way back: `TileWrapper` wraps every tile's content
   * slot this way, so a tile that throws says so inside its own frame and
   * offers a retry, rather than the whole dashboard becoming "render error".
   * Recovery is the parent's job — remount the boundary with a new `key` and
   * it renders its children again from scratch.
   */
  fallback?: ReactNode | ((error: Error) => ReactNode)
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      const { fallback } = this.props
      if (typeof fallback === 'function') return fallback(this.state.error)
      if (fallback !== undefined) return fallback
      return (
        <div className="bg-canvas flex h-screen items-center justify-center">
          <div className="p-8 text-center font-mono">
            <div className="mb-3 text-sm text-red-400">render error</div>
            <div className="max-w-md text-xs break-all text-white/40">
              {this.state.error.message}
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
