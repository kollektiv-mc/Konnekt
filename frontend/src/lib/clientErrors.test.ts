import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LogClientError } from '../../wailsjs/go/main/App'
import { installGlobalErrorReporting, reportClientError } from './clientErrors'

vi.mock('../../wailsjs/go/main/App', () => ({
  LogClientError: vi.fn(() => Promise.resolve()),
}))

// `hasWailsBridge()` reads the *presence* of window.go and never calls through
// it, so an empty object is a bridge as far as the reporter is concerned.
function attachBridge() {
  Object.defineProperty(window, 'go', { value: {}, configurable: true })
}
function detachBridge() {
  delete (window as { go?: unknown }).go
}

beforeEach(() => {
  vi.mocked(LogClientError).mockReset()
  vi.mocked(LogClientError).mockImplementation(() => Promise.resolve())
})
afterEach(detachBridge)

describe('reportClientError', () => {
  it('stays silent with no bridge, because the binding would throw', () => {
    expect('go' in window).toBe(false)
    reportClientError('render', new Error('boom'))
    expect(LogClientError).not.toHaveBeenCalled()
  })

  it('forwards origin, message, stack and detail with a bridge', () => {
    attachBridge()
    const error = new Error('boom')
    reportClientError('render', error, '    in PerformanceTile')
    expect(LogClientError).toHaveBeenCalledTimes(1)
    const [origin, message, stack] = vi.mocked(LogClientError).mock.calls[0]
    expect(origin).toBe('render')
    expect(message).toBe('boom')
    expect(stack).toContain('boom') // the JS stack's first line
    expect(stack).toContain('in PerformanceTile') // the detail, appended
  })

  it('takes a non-Error reason as the message, with no stack', () => {
    attachBridge()
    reportClientError('unhandledrejection', 'plain string rejection')
    expect(LogClientError).toHaveBeenCalledWith('unhandledrejection', 'plain string rejection', '')
  })

  it('never throws when the binding throws synchronously', () => {
    attachBridge()
    vi.mocked(LogClientError).mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'main')")
    })
    expect(() => reportClientError('error', new Error('x'))).not.toThrow()
  })

  it('never leaves a rejection unhandled when the binding rejects', async () => {
    // Vitest fails the run on an unhandled rejection, so reaching the end of
    // this test is the assertion.
    attachBridge()
    vi.mocked(LogClientError).mockRejectedValue(new Error('ipc down'))
    reportClientError('error', new Error('x'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(LogClientError).toHaveBeenCalledTimes(1)
  })
})

describe('installGlobalErrorReporting', () => {
  it('forwards window error and unhandledrejection events until uninstalled', () => {
    attachBridge()
    const uninstall = installGlobalErrorReporting()

    window.dispatchEvent(
      new ErrorEvent('error', { error: new Error('escaped'), message: 'escaped' }),
    )
    expect(LogClientError).toHaveBeenLastCalledWith(
      'error',
      'escaped',
      expect.stringContaining('escaped'),
    )

    // A plain Event carrying `reason`, which is all the listener reads: it
    // avoids depending on whether this jsdom exposes PromiseRejectionEvent as
    // a global, and it avoids creating a genuinely rejected promise.
    const rejection = Object.assign(new Event('unhandledrejection'), {
      reason: new Error('nobody caught me'),
    })
    window.dispatchEvent(rejection)
    expect(LogClientError).toHaveBeenLastCalledWith(
      'unhandledrejection',
      'nobody caught me',
      expect.stringContaining('nobody caught me'),
    )

    uninstall()
    vi.mocked(LogClientError).mockClear()
    // Probed through the rejection event rather than another ErrorEvent:
    // vitest's jsdom environment re-raises a window `error` event carrying an
    // error object as an uncaught exception whenever no user listener is
    // registered, which after the uninstall is exactly the state under test.
    window.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), { reason: new Error('after') }),
    )
    expect(LogClientError).not.toHaveBeenCalled()
  })

  it('falls back to the event message when the error object is withheld', () => {
    // A cross-origin script error reaches the listener with `error: null`.
    attachBridge()
    const uninstall = installGlobalErrorReporting()
    window.dispatchEvent(new ErrorEvent('error', { error: null, message: 'Script error.' }))
    expect(LogClientError).toHaveBeenLastCalledWith('error', 'Script error.', '')
    uninstall()
  })
})
