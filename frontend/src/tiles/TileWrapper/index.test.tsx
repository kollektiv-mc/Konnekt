import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { lazy, Suspense, type ReactElement, type ReactNode } from 'react'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { TileWrapper } from '.'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { Gauge } from '../../lib/icons'

// Every tile renders through TileWrapper's content slot — the grid copy and
// the maximized copy alike (Dashboard.tsx) — so a boundary there is what keeps
// one tile's render error inside that tile. Until it existed the app-level
// boundary in main.tsx was the only one, and a tile that threw replaced the
// whole dashboard with "render error" (agent_docs/HEALTH_CHECKLIST.md's
// "One ErrorBoundary for eleven tiles" backlog item; HEALTH_LOG.md 2026-09-01).
//
// globals: false in vite.config.ts, so cleanup is explicit.
afterEach(cleanup)

// React reports every error a boundary catches through console.error. That is
// the expected path here, not a failure, so it is silenced per test and
// restored after.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

function Broken({ message }: { message: string }): never {
  throw new Error(message)
}

// A flag rather than a "throws N times" counter: React retries a render that
// threw once before handing it to the boundary, so a counter would have to
// know how many attempts that is. A flag the test flips is exact.
let contentBroken = true
function Flaky() {
  if (contentBroken) throw new Error('boom')
  return <div>tile content</div>
}

function wrap(children: ReactNode, props: Partial<Parameters<typeof TileWrapper>[0]> = {}) {
  return (
    <TileWrapper
      id="performance"
      label="Performance"
      icon={Gauge}
      onRemove={() => {}}
      maximizable
      {...props}
    >
      {children}
    </TileWrapper>
  )
}

describe('TileWrapper error containment', () => {
  it('shows the failure inside the tile, with the header still there', () => {
    render(wrap(<Broken message="widget exploded" />))
    expect(screen.getByText('Performance')).toBeTruthy()
    expect(screen.getByText('tile failed to render')).toBeTruthy()
    expect(screen.getByText('widget exploded')).toBeTruthy()
  })

  it('never reaches the app-level boundary', () => {
    // main.tsx's boundary, with its default full-screen fallback. If the tile
    // boundary let the error through, this is what the user would see.
    render(<ErrorBoundary>{wrap(<Broken message="widget exploded" />)}</ErrorBoundary>)
    expect(screen.queryByText('render error')).toBeNull()
    expect(screen.getByText('tile failed to render')).toBeTruthy()
  })

  it('keeps Remove working on a failed tile', () => {
    const onRemove = vi.fn()
    render(wrap(<Broken message="widget exploded" />, { onRemove }))
    fireEvent.click(screen.getByTitle('Remove tile'))
    expect(onRemove).toHaveBeenCalledWith('performance')
  })

  it('keeps Maximize working on a failed tile', () => {
    const onToggleMaximize = vi.fn()
    render(wrap(<Broken message="widget exploded" />, { onToggleMaximize }))
    fireEvent.click(screen.getByTitle('Maximize tile'))
    expect(onToggleMaximize).toHaveBeenCalledWith('performance')
  })

  it('keeps Restore on the maximized copy of a failed tile', () => {
    const onToggleMaximize = vi.fn()
    render(wrap(<Broken message="widget exploded" />, { maximized: true, onToggleMaximize }))
    expect(screen.getByText('tile failed to render')).toBeTruthy()
    fireEvent.click(screen.getByTitle('Restore tile'))
    expect(onToggleMaximize).toHaveBeenCalledWith('performance')
  })

  it('Retry mounts the content again from scratch', () => {
    contentBroken = true
    render(wrap(<Flaky />))
    expect(screen.getByText('tile failed to render')).toBeTruthy()
    expect(screen.queryByText('tile content')).toBeNull()

    // A retry with nothing changed fails again, and stays inside the tile.
    fireEvent.click(screen.getByText('Retry'))
    expect(screen.getByText('tile failed to render')).toBeTruthy()

    contentBroken = false
    fireEvent.click(screen.getByText('Retry'))
    expect(screen.queryByText('tile failed to render')).toBeNull()
    expect(screen.getByText('tile content')).toBeTruthy()
  })

  it('contains a lazy chunk that fails to load', async () => {
    // The shape every code-split tile has: React.lazy inside the tile's own
    // Suspense (tiles/worlds/index.tsx and four others). A rejected import
    // throws from the lazy component's render, above the Suspense, so it has
    // to be the wrapper's boundary that catches it.
    const Chunk = lazy<() => ReactElement>(() => Promise.reject(new Error('chunk failed to load')))
    render(
      <ErrorBoundary>
        {wrap(
          <Suspense fallback={<div>loading</div>}>
            <Chunk />
          </Suspense>,
        )}
      </ErrorBoundary>,
    )
    expect(await screen.findByText('tile failed to render')).toBeTruthy()
    expect(screen.getByText('chunk failed to load')).toBeTruthy()
    expect(screen.queryByText('render error')).toBeNull()
    expect(screen.getByText('Performance')).toBeTruthy()
  })

  it('renders content normally when nothing throws', () => {
    render(wrap(<div>tile content</div>))
    expect(screen.getByText('tile content')).toBeTruthy()
    expect(screen.queryByText('tile failed to render')).toBeNull()
    expect(screen.queryByText('Retry')).toBeNull()
  })
})
