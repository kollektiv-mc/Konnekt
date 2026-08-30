import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /**
   * What to render in place of a subtree that threw. The default fills the
   * viewport, which is right for the app-level boundary in `main.tsx` and
   * absurd anywhere smaller — the Overview panel wraps each summary card in
   * its own boundary so one failing tile summary does not blank the panel (or,
   * since this was the only boundary in the tree, the whole app), and passes a
   * fallback that fits a card.
   */
  fallback?: ReactNode
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
      if (this.props.fallback !== undefined) return this.props.fallback
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
