import { describe, it, expect, afterEach } from 'vitest'
import { errMsg, hasWailsBridge, readOr } from './ipc'

afterEach(() => {
  Reflect.deleteProperty(window, 'go')
})

describe('errMsg', () => {
  it('reads the message off an Error', () => {
    expect(errMsg(new Error('disk full'))).toBe('disk full')
  })

  it('stringifies the plain strings Wails rejects with', () => {
    expect(errMsg('permission denied')).toBe('permission denied')
  })

  it('stringifies a non-Error, non-string rejection rather than returning undefined', () => {
    expect(errMsg(null)).toBe('null')
    expect(errMsg({ code: 5 })).toBe('[object Object]')
  })
})

describe('hasWailsBridge', () => {
  it('is false in a plain browser context, which is what frontend-dev is', () => {
    expect(hasWailsBridge()).toBe(false)
  })

  it('is true once the Wails backend has injected window.go', () => {
    Object.assign(window, { go: {} })
    expect(hasWailsBridge()).toBe(true)
  })
})

describe('readOr', () => {
  it('returns the value when the call resolves', async () => {
    await expect(readOr(() => Promise.resolve('0.1.0'), null)).resolves.toBe('0.1.0')
  })

  it('falls back when the call rejects', async () => {
    await expect(readOr(() => Promise.reject(new Error('no server')), null)).resolves.toBeNull()
  })

  // The reason this helper exists. A generated binding with no bridge behind it
  // throws while dereferencing `window.go`, before there is a promise to reject,
  // so a `.catch()` on the call site never runs and the throw escapes.
  it('falls back when the call throws synchronously, as a binding with no bridge does', async () => {
    await expect(
      readOr(() => {
        throw new TypeError("Cannot read properties of undefined (reading 'main')")
      }, null),
    ).resolves.toBeNull()
  })
})
