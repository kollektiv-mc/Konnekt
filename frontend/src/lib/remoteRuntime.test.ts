import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import {
  GetActiveServerID,
  GetServerStatus,
  SaveActiveLayout,
  SaveActiveTiles,
  SaveAppSettings,
  SaveLayoutPreset,
  SaveServerConfig,
  SaveTileLayouts,
  SetActiveServerID,
} from '../../wailsjs/go/main/App'
import { hasWailsBridge, isRemoteBrowser } from './ipc'
import appSource from '../../wailsjs/go/main/App.js?raw'
import runtimeSource from '../../wailsjs/runtime/runtime.js?raw'
import {
  connectEvents,
  getRemoteClient,
  installRemoteRuntime,
  probeSession,
  signOut,
  subscribeRemoteClient,
} from './remoteRuntime'

// A reply the way the listener writes it: JSON for the dispatcher's answers,
// plain text for the guard's and the authorizer's.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const text = (body: string, status: number) => new Response(body, { status })

class FakeSocket {
  static all: FakeSocket[] = []
  onmessage: ((ev: MessageEvent) => void) | null = null
  onclose: (() => void) | null = null
  closed = false
  constructor(readonly url: string) {
    FakeSocket.all.push(this)
  }
  close() {
    this.closed = true
  }
  receive(frame: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(frame) }))
  }
  hello(seq: number, data: { replayed?: number; gap?: boolean; run?: string } = {}) {
    this.receive({
      seq,
      event: 'remote:hello',
      data: { replayed: 0, gap: false, run: 'run-a', ...data },
    })
  }
  drop() {
    this.onclose?.()
  }
}

const sockets = () => FakeSocket.all
const lastSocket = () => FakeSocket.all[FakeSocket.all.length - 1]

type Runtime = Record<string, (...args: unknown[]) => unknown>
const runtime = () => Reflect.get(window, 'runtime') as Runtime

const fetchMock = vi.fn<typeof fetch>()
const onLocked = vi.fn()
const onResync = vi.fn()

beforeEach(() => {
  // Offline unless a test says otherwise, which is what a probe fired by a
  // socket test's first drop should find.
  fetchMock.mockReset().mockRejectedValue(new TypeError('offline'))
  onLocked.mockReset()
  onResync.mockReset()
  FakeSocket.all = []
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('WebSocket', FakeSocket)
  installRemoteRuntime({ onLocked, onResync })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'go')
  Reflect.deleteProperty(window, 'runtime')
})

describe('the installed globals', () => {
  it('still reads as a remote browser once its bridge is installed', () => {
    vi.stubEnv('PROD', true)
    expect(hasWailsBridge()).toBe(true)
    expect(isRemoteBrowser()).toBe(true)
    vi.unstubAllEnvs()
  })

  it('has a function for every export of the generated App bindings', () => {
    const exported = [...appSource.matchAll(/^export function (\w+)/gm)].map((m) => m[1])
    expect(exported.length).toBeGreaterThan(50)
    const app = Reflect.get(Reflect.get(Reflect.get(window, 'go'), 'main'), 'App')
    for (const name of exported) {
      expect(typeof app[name], name).toBe('function')
    }
  })

  it('has every window.runtime member the generated runtime dereferences', () => {
    const used = new Set([...runtimeSource.matchAll(/window\.runtime\.(\w+)/g)].map((m) => m[1]))
    expect(used.size).toBeGreaterThan(40)
    for (const name of used) {
      expect(typeof runtime()[name], name).toBe('function')
    }
  })

  it('answers Environment and the window queries with web defaults', async () => {
    await expect(runtime().Environment()).resolves.toEqual({
      buildType: 'production',
      platform: 'web',
      arch: '',
    })
    await expect(runtime().WindowIsMaximised()).resolves.toBe(false)
    expect(runtime().CanResolveFilePaths()).toBe(false)
  })

  it('opens web links in a tab that cannot reach back, and nothing else', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    runtime().BrowserOpenURL('https://aka.ms/MinecraftEULA')
    expect(open).toHaveBeenCalledWith(
      'https://aka.ms/MinecraftEULA',
      '_blank',
      'noopener,noreferrer',
    )
    open.mockClear()
    runtime().BrowserOpenURL('javascript:alert(1)')
    expect(open).not.toHaveBeenCalled()
  })

  it('sets the document title and logs to the console', () => {
    runtime().WindowSetTitle('Konnekt remote')
    expect(document.title).toBe('Konnekt remote')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    runtime().LogWarning('careful')
    expect(warn).toHaveBeenCalledWith('careful')
  })

  it('writes the clipboard where the browser has one, and says so where it does not', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await expect(runtime().ClipboardSetText('hi')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hi')
    vi.stubGlobal('navigator', {})
    await expect(runtime().ClipboardSetText('hi')).resolves.toBe(false)
    await expect(runtime().ClipboardGetText()).resolves.toBe('')
  })
})

describe('a bound call', () => {
  it('posts the method and its positional arguments as JSON, with the session cookie', async () => {
    fetchMock.mockResolvedValue(json({ result: { running: true } }))
    await expect(GetServerStatus('s1')).resolves.toEqual({ running: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/rpc')
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('same-origin')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init?.body))).toEqual({ method: 'GetServerStatus', args: ['s1'] })
  })

  it('resolves undefined for a method with no result', async () => {
    fetchMock.mockResolvedValue(json({}))
    await expect(GetServerStatus('s1')).resolves.toBeUndefined()
  })

  it('rejects with the bare message string when the method ran and said no', async () => {
    fetchMock.mockResolvedValue(json({ error: 'server not found' }))
    await expect(GetServerStatus('s1')).rejects.toBe('server not found')
  })

  it.each([
    [400, json({ error: 'bad arguments' }, 400), 'bad arguments'],
    [403, json({ error: 'needs desktop approval' }, 403), 'needs desktop approval'],
    [403, text('unexpected origin\n', 403), 'unexpected origin'],
    [404, json({ error: 'unknown method' }, 404), 'unknown method'],
    [500, text('', 500), 'Request failed (500)'],
  ])('rejects a %i with its message', async (_status, reply, message) => {
    fetchMock.mockResolvedValue(reply)
    await expect(GetServerStatus('s1')).rejects.toThrow(message)
  })

  it('rejects with an error saying Konnekt is unreachable when the network fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(GetServerStatus('s1')).rejects.toThrow(/unreachable/i)
    expect(onLocked).not.toHaveBeenCalled()
  })

  it('rejects an unreadable 200 rather than resolving garbage', async () => {
    fetchMock.mockResolvedValue(text('<html>captive portal</html>', 200))
    await expect(GetServerStatus('s1')).rejects.toThrow(/unreadable/i)
  })

  it('does not lock on a 401 before the dashboard was ever reachable', async () => {
    fetchMock.mockResolvedValue(text('unauthorized', 401))
    await expect(GetServerStatus('s1')).rejects.toThrow()
    await expect(GetServerStatus('s1')).rejects.toThrow()
    expect(onLocked).not.toHaveBeenCalled()
  })

  it('locks once, on the first 401 after a call has succeeded', async () => {
    fetchMock.mockResolvedValueOnce(json({ result: 1 }))
    await GetServerStatus('s1')
    fetchMock.mockImplementation(() => Promise.resolve(text('unauthorized', 401)))
    await expect(GetServerStatus('s1')).rejects.toThrow()
    await expect(GetServerStatus('s1')).rejects.toThrow()
    expect(onLocked).toHaveBeenCalledTimes(1)
  })
})

describe('probeSession', () => {
  it('reads GET /api/session with the cookie and maps the status', async () => {
    fetchMock.mockResolvedValueOnce(json({ device: 'Pixel', admin: [] }))
    await expect(probeSession()).resolves.toBe('ok')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/session')
    expect(init?.credentials).toBe('same-origin')
    expect(getRemoteClient().device).toBe('Pixel')
    fetchMock.mockResolvedValueOnce(text('unauthorized', 401))
    await expect(probeSession()).resolves.toBe('locked')
    fetchMock.mockResolvedValueOnce(text('bad gateway', 502))
    await expect(probeSession()).resolves.toBe('unreachable')
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(probeSession()).resolves.toBe('unreachable')
  })

  it('is still ok, with an empty device, for a 200 that is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(text('<html>captive portal</html>', 200))
    await expect(probeSession()).resolves.toBe('ok')
    expect(getRemoteClient().device).toBe('')
  })

  it('counts as the confirmation a later 401 is read against', async () => {
    fetchMock.mockResolvedValueOnce(json({ device: 'Pixel', admin: [] }))
    await probeSession()
    fetchMock.mockResolvedValueOnce(text('unauthorized', 401))
    await expect(GetServerStatus('s1')).rejects.toThrow()
    expect(onLocked).toHaveBeenCalledTimes(1)
  })

  it('does not lock by itself, since the gate decides what a locked probe renders', async () => {
    fetchMock.mockResolvedValue(text('unauthorized', 401))
    await probeSession()
    expect(onLocked).not.toHaveBeenCalled()
  })
})

describe('the selected server', () => {
  const rpcMethods = () =>
    fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).method)

  it('asks the desktop once, then answers from memory', async () => {
    fetchMock.mockResolvedValue(json({ result: 's1' }))
    await expect(GetActiveServerID()).resolves.toBe('s1')
    await expect(GetActiveServerID()).resolves.toBe('s1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(rpcMethods()).toEqual(['GetActiveServerID'])
  })

  it('keeps a choice to itself and returns it', async () => {
    await SetActiveServerID('s2')
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(GetActiveServerID()).resolves.toBe('s2')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lets a choice made before the first read win over a slow desktop answer', async () => {
    let answer: (r: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)))
    const read = GetActiveServerID()
    await SetActiveServerID('s2')
    answer(json({ result: 's1' }))
    await expect(read).resolves.toBe('s2')
    await expect(GetActiveServerID()).resolves.toBe('s2')
  })
})

describe('what a tab keeps to itself', () => {
  it('resolves the settings and canvas saves without a request', async () => {
    await expect(SaveAppSettings({} as never)).resolves.toBeUndefined()
    await expect(SaveActiveTiles([])).resolves.toBeUndefined()
    await expect(SaveActiveLayout('[]')).resolves.toBeUndefined()
    await expect(SaveTileLayouts({})).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still sends a named preset, which is a deliberate save', async () => {
    fetchMock.mockResolvedValue(json({}))
    await SaveLayoutPreset('Mine', '[]')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('an admin-tier call', () => {
  const adminSession = () => {
    fetchMock.mockResolvedValueOnce(json({ device: 'Pixel', admin: ['SaveServerConfig'] }))
    return probeSession()
  }
  interface Gate {
    resolve: (r: Response) => void
    reject: (e: unknown) => void
  }
  const pending = (): Gate => {
    const gate = {} as Gate
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve, reject) => {
        gate.resolve = resolve
        gate.reject = reject
      }),
    )
    return gate
  }
  const save = () => SaveServerConfig({} as never)

  it('is listed as waiting while in flight and removed on success', async () => {
    await adminSession()
    const gate = pending()
    const watcher = vi.fn()
    subscribeRemoteClient(watcher)
    const call = save()
    expect(getRemoteClient().waiting).toEqual(['SaveServerConfig'])
    expect(watcher).toHaveBeenCalledTimes(1)
    gate.resolve(json({}))
    await call
    expect(getRemoteClient().waiting).toEqual([])
    expect(watcher).toHaveBeenCalledTimes(2)
  })

  it('is removed when the call rejects', async () => {
    await adminSession()
    const gate = pending()
    const call = save()
    expect(getRemoteClient().waiting).toEqual(['SaveServerConfig'])
    gate.reject(new TypeError('offline'))
    await expect(call).rejects.toThrow()
    expect(getRemoteClient().waiting).toEqual([])
  })

  it('tells subscribers until they unsubscribe', async () => {
    await adminSession()
    const watcher = vi.fn()
    const off = subscribeRemoteClient(watcher)
    off()
    const gate = pending()
    const call = save()
    gate.resolve(json({}))
    await call
    expect(watcher).not.toHaveBeenCalled()
  })

  it('is never announced for a method that is not admin tier', async () => {
    await adminSession()
    const gate = pending()
    const call = GetServerStatus('s1')
    expect(getRemoteClient().waiting).toEqual([])
    gate.resolve(json({ result: 1 }))
    await call
    expect(getRemoteClient().waiting).toEqual([])
  })

  it('counts two concurrent calls of one method and removes them one at a time', async () => {
    await adminSession()
    const first = pending()
    const second = pending()
    const a = save()
    const b = save()
    expect(getRemoteClient().waiting).toEqual(['SaveServerConfig', 'SaveServerConfig'])
    first.resolve(json({}))
    await a
    expect(getRemoteClient().waiting).toEqual(['SaveServerConfig'])
    second.resolve(json({}))
    await b
    expect(getRemoteClient().waiting).toEqual([])
  })

  it('rewrites a 403 refusal into words for whoever clicked', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        { error: 'method needs desktop approval: SaveServerConfig: declined on the desktop' },
        403,
      ),
    )
    const refused = await GetServerStatus('s1').catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(Error)
    expect((refused as Error).message).toBe('Not approved on the desktop: declined on the desktop.')

    fetchMock.mockResolvedValueOnce(json({ error: 'method needs desktop approval' }, 403))
    await expect(GetServerStatus('s1')).rejects.toThrow(
      'This change needs approval on the desktop.',
    )

    fetchMock.mockResolvedValueOnce(text('unexpected origin', 403))
    await expect(GetServerStatus('s1')).rejects.toThrow(/^unexpected origin$/)
  })
})

describe('signOut', () => {
  const stubLocation = () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    return reload
  }

  it('posts the logout with the cookie, then reloads', async () => {
    const reload = stubLocation()
    fetchMock.mockResolvedValueOnce(json({}))
    await signOut()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/logout')
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('same-origin')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads even when the request fails', async () => {
    const reload = stubLocation()
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    await signOut()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('installRemoteRuntime', () => {
  it('resets the client to no device and nothing waiting', async () => {
    fetchMock.mockResolvedValueOnce(json({ device: 'Pixel', admin: ['SaveServerConfig'] }))
    await probeSession()
    fetchMock.mockReturnValueOnce(new Promise<Response>(() => {}))
    void SaveServerConfig({} as never)
    expect(getRemoteClient()).toEqual({ device: 'Pixel', waiting: ['SaveServerConfig'] })
    installRemoteRuntime({ onLocked, onResync })
    expect(getRemoteClient()).toEqual({ device: '', waiting: [] })
  })
})

describe('the event registry', () => {
  const emit = (name: string, ...args: unknown[]) => runtime().EventsEmit(name, ...args)

  it('hands a listener the payload', () => {
    const cb = vi.fn()
    runtime().EventsOn('log:line', cb)
    emit('log:line', { line: 'hello' })
    expect(cb).toHaveBeenCalledWith({ line: 'hello' })
  })

  it('fires EventsOnce once and EventsOnMultiple its count', () => {
    const once = vi.fn()
    const twice = vi.fn()
    runtime().EventsOnce('e', once)
    runtime().EventsOnMultiple('e', twice, 2)
    emit('e', 1)
    emit('e', 2)
    emit('e', 3)
    expect(once).toHaveBeenCalledTimes(1)
    expect(twice).toHaveBeenCalledTimes(2)
  })

  it('stops a listener at its unsubscriber, and only that one', () => {
    const a = vi.fn()
    const b = vi.fn()
    const off = runtime().EventsOn('e', a) as () => void
    runtime().EventsOn('e', b)
    off()
    emit('e')
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('drops every listener of the named events with EventsOff, and of all with EventsOffAll', () => {
    const a = vi.fn()
    const b = vi.fn()
    const c = vi.fn()
    runtime().EventsOn('a', a)
    runtime().EventsOn('b', b)
    runtime().EventsOn('c', c)
    runtime().EventsOff('a', 'b')
    emit('a')
    emit('b')
    emit('c')
    expect([a, b, c].map((f) => f.mock.calls.length)).toEqual([0, 0, 1])
    runtime().EventsOffAll()
    emit('c')
    expect(c).toHaveBeenCalledTimes(1)
  })

  it('lets one throwing handler be logged without stopping the rest', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const after = vi.fn()
    runtime().EventsOn('e', () => {
      throw new Error('bad subscriber')
    })
    runtime().EventsOn('e', after)
    emit('e', 'x')
    expect(after).toHaveBeenCalledWith('x')
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('survives a handler that unsubscribes while the event is dispatched', () => {
    const second = vi.fn()
    const off = runtime().EventsOn('e', () => off()) as () => void
    runtime().EventsOn('e', second)
    emit('e')
    emit('e')
    expect(second).toHaveBeenCalledTimes(2)
  })
})

describe('connectEvents', () => {
  it('opens the same-origin socket with no since on a fresh page', () => {
    const stop = connectEvents()
    expect(sockets()).toHaveLength(1)
    expect(lastSocket().url).toBe(`ws://${window.location.host}/ws`)
    stop()
  })

  it('uses wss on an https page', () => {
    vi.stubGlobal('location', { protocol: 'https:', host: 'konnekt.example', reload: vi.fn() })
    const stop = connectEvents()
    expect(lastSocket().url).toBe('wss://konnekt.example/ws')
    stop()
  })

  it('dispatches each frame to its listeners as cb(data), in order', () => {
    const cb = vi.fn()
    runtime().EventsOn('log:line', cb)
    const stop = connectEvents()
    const ws = lastSocket()
    ws.hello(0)
    ws.receive({ seq: 1, event: 'log:line', data: { line: 'a' } })
    ws.receive({ seq: 2, event: 'log:line', data: { line: 'b' } })
    expect(cb.mock.calls).toEqual([[{ line: 'a' }], [{ line: 'b' }]])
    stop()
  })

  it('ignores a frame it has already seen', () => {
    const cb = vi.fn()
    runtime().EventsOn('e', cb)
    const stop = connectEvents()
    const ws = lastSocket()
    ws.hello(0)
    ws.receive({ seq: 1, event: 'e', data: 'one' })
    ws.receive({ seq: 1, event: 'e', data: 'one again' })
    ws.receive({ seq: 3, event: 'e', data: 'three' })
    ws.receive({ seq: 2, event: 'e', data: 'late' })
    expect(cb.mock.calls).toEqual([['one'], ['three']])
    stop()
  })

  it('ignores a malformed frame with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cb = vi.fn()
    runtime().EventsOn('e', cb)
    const stop = connectEvents()
    const ws = lastSocket()
    ws.onmessage?.(new MessageEvent('message', { data: 'not json' }))
    ws.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ event: 'e' }) }))
    ws.receive({ seq: 1, event: 'e', data: 'fine' })
    expect(warn).toHaveBeenCalledTimes(2)
    expect(cb.mock.calls).toEqual([['fine']])
    stop()
  })

  it('reconnects with the last number it saw, and takes the server position from a quiet hello', () => {
    vi.useFakeTimers()
    const stop = connectEvents()
    lastSocket().hello(10)
    lastSocket().receive({ seq: 11, event: 'e', data: null })
    lastSocket().drop()
    vi.advanceTimersByTime(1000)
    expect(sockets()).toHaveLength(2)
    expect(lastSocket().url).toMatch(/\/ws\?since=11&run=run-a$/)
    // Replayed frames follow the hello and must not read as already seen.
    const cb = vi.fn()
    runtime().EventsOn('e', cb)
    lastSocket().hello(13, { replayed: 2 })
    lastSocket().receive({ seq: 12, event: 'e', data: 'twelve' })
    lastSocket().receive({ seq: 13, event: 'e', data: 'thirteen' })
    expect(cb.mock.calls).toEqual([['twelve'], ['thirteen']])
    expect(onResync).not.toHaveBeenCalled()
    stop()
  })

  it('carries the position of a first hello into the next reconnect', () => {
    vi.useFakeTimers()
    const stop = connectEvents()
    lastSocket().hello(40)
    lastSocket().drop()
    vi.advanceTimersByTime(1000)
    expect(lastSocket().url).toMatch(/\/ws\?since=40&run=run-a$/)
    stop()
  })

  it('sends the run of the latest hello, which a gap hello replaces', () => {
    vi.useFakeTimers()
    const stop = connectEvents()
    lastSocket().hello(5, { gap: true, run: 'run-b' })
    lastSocket().drop()
    vi.advanceTimersByTime(1000)
    expect(lastSocket().url).toMatch(/\/ws\?since=5&run=run-b$/)
    stop()
  })

  it('sends neither since nor run on a page that has seen nothing', () => {
    const stop = connectEvents()
    expect(lastSocket().url).not.toMatch(/since|run/)
    stop()
  })

  it('asks for a resync when the server says the replay had a gap', () => {
    const stop = connectEvents()
    lastSocket().hello(500, { gap: true })
    expect(onResync).toHaveBeenCalledTimes(1)
    stop()
  })

  it('asks for a resync when the server numbering restarted below ours', () => {
    vi.useFakeTimers()
    const stop = connectEvents()
    lastSocket().hello(0)
    lastSocket().receive({ seq: 90, event: 'e', data: null })
    lastSocket().drop()
    vi.advanceTimersByTime(1000)
    lastSocket().hello(3)
    expect(onResync).toHaveBeenCalledTimes(1)
    stop()
  })

  it('backs off 1s, doubling to a 30s cap, and starts over after a hello', () => {
    vi.useFakeTimers()
    const stop = connectEvents()
    const expected = [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]
    for (const [i, wait] of expected.entries()) {
      const before = sockets().length
      lastSocket().drop()
      vi.advanceTimersByTime(wait - 1)
      expect(sockets().length, `still waiting before attempt ${i + 1}`).toBe(before)
      vi.advanceTimersByTime(1)
      expect(sockets().length, `attempt ${i + 1}`).toBe(before + 1)
    }
    lastSocket().hello(0)
    const before = sockets().length
    lastSocket().drop()
    vi.advanceTimersByTime(1000)
    expect(sockets()).toHaveLength(before + 1)
    stop()
  })

  it('probes after a close that came before any hello, and locks on a 401', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(text('unauthorized', 401))
    const stop = connectEvents()
    lastSocket().drop()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onLocked).toHaveBeenCalledTimes(1)
    // A locked page does not keep knocking.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sockets()).toHaveLength(1)
    stop()
  })

  it('keeps reconnecting when the probe says the app is just unreachable', async () => {
    vi.useFakeTimers()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const stop = connectEvents()
    lastSocket().drop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(onLocked).not.toHaveBeenCalled()
    expect(sockets()).toHaveLength(2)
    stop()
  })

  it('does not probe a socket that had said hello', async () => {
    vi.useFakeTimers()
    const stop = connectEvents()
    lastSocket().hello(0)
    lastSocket().drop()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).not.toHaveBeenCalled()
    stop()
  })

  it('reconnects at once when the page becomes visible or the network returns', () => {
    vi.useFakeTimers()
    const stop = connectEvents()
    lastSocket().drop()
    expect(sockets()).toHaveLength(1)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(sockets()).toHaveLength(2)
    // A socket that is still open is left alone.
    window.dispatchEvent(new Event('online'))
    expect(sockets()).toHaveLength(2)
    lastSocket().drop()
    window.dispatchEvent(new Event('online'))
    expect(sockets()).toHaveLength(3)
    stop()
  })

  it('stops for good when asked to', () => {
    vi.useFakeTimers()
    const stop = connectEvents()
    const ws = lastSocket()
    stop()
    expect(ws.closed).toBe(true)
    ws.drop()
    vi.advanceTimersByTime(60_000)
    window.dispatchEvent(new Event('online'))
    expect(sockets()).toHaveLength(1)
  })
})
