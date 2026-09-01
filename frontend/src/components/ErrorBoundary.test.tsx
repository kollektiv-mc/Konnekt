import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

afterEach(cleanup)

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

function Broken(): never {
  throw new Error('kaput')
}

describe('ErrorBoundary', () => {
  it('renders its children while nothing throws', () => {
    render(
      <ErrorBoundary>
        <div>fine</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('fine')).toBeTruthy()
  })

  it('falls back to the full-screen default with the message', () => {
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    )
    expect(screen.getByText('render error')).toBeTruthy()
    expect(screen.getByText('kaput')).toBeTruthy()
  })

  it('renders a node fallback as given', () => {
    render(
      <ErrorBoundary fallback={<div>unavailable</div>}>
        <Broken />
      </ErrorBoundary>,
    )
    expect(screen.getByText('unavailable')).toBeTruthy()
    expect(screen.queryByText('render error')).toBeNull()
  })

  it('hands a function fallback the error', () => {
    const fallback = vi.fn((error: Error) => <div>caught: {error.message}</div>)
    render(
      <ErrorBoundary fallback={fallback}>
        <Broken />
      </ErrorBoundary>,
    )
    expect(screen.getByText('caught: kaput')).toBeTruthy()
    expect(fallback).toHaveBeenCalledWith(expect.any(Error))
    expect(fallback.mock.calls[0][0].message).toBe('kaput')
  })
})
