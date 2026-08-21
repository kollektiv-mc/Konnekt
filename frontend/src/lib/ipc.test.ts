import { describe, it, expect, afterEach } from 'vitest'
import { errMsg, hasWailsBridge } from './ipc'

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
