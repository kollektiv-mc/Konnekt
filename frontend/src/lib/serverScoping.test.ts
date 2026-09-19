// @vitest-environment node

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EVENTS } from './constants'

// Per-server scoping, held on the listening side (#237).
//
// #233 put a serverID on every server-scoped event and #234 keyed the tile
// tree by server, so a listener can filter. Nothing made it: `useWorlds`
// refetched on every server's stop and backup, and the EULA modal accepted for
// the active server whichever one had tripped it. Both were found by this test
// on the day it was written. It reads every `EventsOn` registration under src/
// and requires the handler for a server-scoped event to read the payload's
// `serverID`, go through `isForActiveServer`, or be listed below with the
// reason it is global on purpose.
//
// It is a source scan rather than a .claude/suite.json invariant because the
// condition is not one line: the filter may sit in the handler, or in a
// predicate declared beside it (`usePlayers`'s `mine`), and an invariant is a
// regex that must find nothing. The Go half, scoping_test.go at the repo root,
// holds the emitting side with the same classification; the two lists below
// mirror its `globalEvents`, and `serverSwitch.test.tsx` proves the filters do
// what they say.

const src = fileURLToPath(new URL('..', import.meta.url))

/** Events whose payload carries no server id, mirroring scoping_test.go. */
const GLOBAL_EVENTS = new Set<keyof typeof EVENTS>([
  'INSTALL_STARTED',
  'INSTALL_LOG',
  'INSTALL_FINISHED',
  'INSTALL_FAILED',
  'UPDATE_PROGRESS',
  'COMMANDS_CHANGED',
  'SCHEDULE_NOTIFY',
  'SCHEDULE_NEXT_RUNS',
])

/**
 * Registrations of a server-scoped event whose handler deliberately does not
 * filter, keyed `path#EVENT` with the path relative to src/. Each carries its
 * reason, and an entry that no longer matches an unfiltered registration fails
 * the test so the list cannot rot.
 */
const GLOBAL_ON_PURPOSE: Record<string, string> = {
  'App.tsx#SERVER_STOPPED':
    'a crash notification is app-wide: the user should hear about any server',
  'App.tsx#SERVER_STARTED': 'app-wide notification, as above',
  'App.tsx#PLAYER_JOINED': 'app-wide notification, as above',
  'App.tsx#PLAYER_LEFT': 'app-wide notification, as above',
  'App.tsx#RESTORE_COMPLETED': 'app-wide notification, as above',
  'App.tsx#RESTORE_FAILED': 'app-wide notification, as above',
  'App.tsx#AUTOSAVE_STUCK': 'app-wide notification, as above',
  'App.tsx#STATS_SNAPSHOT':
    'the low-TPS warning is app-wide; its hysteresis latch is one flag because one server runs at a time (#57 is Later)',
  'App.tsx#LOADER_UPDATE_FINISHED':
    'keyed through `current`, which the LOADER_UPDATE_STARTED handler sets from the payload; the installer runs one job at a time',
  'App.tsx#LOADER_UPDATE_FAILED': 'as LOADER_UPDATE_FINISHED',
  'tiles/scheduler/editor/GraphEditor.tsx#SCHEDULE_RUN_STARTED':
    'filtered on graphId, which is tighter: a graph belongs to one server (#236) and the editor shows one graph',
  'tiles/scheduler/editor/GraphEditor.tsx#SCHEDULE_NODE_STARTED': 'as SCHEDULE_RUN_STARTED',
  'tiles/scheduler/editor/GraphEditor.tsx#SCHEDULE_NODE_FINISHED': 'as SCHEDULE_RUN_STARTED',
  'tiles/scheduler/editor/GraphEditor.tsx#SCHEDULE_RUN_FINISHED': 'as SCHEDULE_RUN_STARTED',
}

/** What counts as reading the server id. */
const FILTER_SIGNS = [/\bserverID\b/, /\bisForActiveServer\(/]

interface Registration {
  key: string
  where: string
  event: string
  handler: string
  /** The innermost function body the call sits in, for a handler passed by name. */
  scope: string
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...sourceFiles(path))
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(path)
    }
  }
  return out
}

/**
 * Blanks string literals, template literals and comments, keeping every
 * index, so bracket matching below cannot be fooled by a brace in a string.
 */
function blankNonCode(text: string): string {
  const out = text.split('')
  let i = 0
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '
  }
  while (i < text.length) {
    const c = text[i]
    const next = text[i + 1]
    if (c === '/' && next === '/') {
      const end = text.indexOf('\n', i)
      const stop = end === -1 ? text.length : end
      blank(i, stop)
      i = stop
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end === -1 ? text.length : end + 2
      blank(i, stop)
      i = stop
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < text.length && text[j] !== c) {
        if (text[j] === '\\') j++
        j++
      }
      blank(i + 1, j)
      i = j + 1
    } else {
      i++
    }
  }
  return out.join('')
}

function matchingParen(code: string, open: number): number {
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++
    else if (code[i] === ')' && --depth === 0) return i
  }
  return -1
}

/** The innermost `{ ... }` enclosing `at` that opens a function body. */
function enclosingBody(code: string, at: number): string {
  let depth = 0
  for (let i = at; i >= 0; i--) {
    const c = code[i]
    if (c === '}') depth++
    else if (c === '{') {
      if (depth > 0) {
        depth--
        continue
      }
      const before = code.slice(Math.max(0, i - 3), i).trimEnd()
      if (before.endsWith('=>') || before.endsWith(')')) {
        let d = 0
        for (let j = i; j < code.length; j++) {
          if (code[j] === '{') d++
          else if (code[j] === '}' && --d === 0) return code.slice(i, j + 1)
        }
      }
    }
  }
  return ''
}

function registrationsIn(path: string): Registration[] {
  const text = readFileSync(path, 'utf8')
  const code = blankNonCode(text)
  const rel = relative(src, path).split(sep).join('/')
  const out: Registration[] = []
  const re = /\bEventsOn\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    const open = m.index + m[0].length - 1
    const close = matchingParen(code, open)
    const line = code.slice(0, m.index).split('\n').length
    const where = `${rel}:${line}`
    expect(close, `${where}: unbalanced EventsOn( call`).toBeGreaterThan(open)
    const args = code.slice(open + 1, close)
    const first = /^\s*EVENTS\.([A-Z_]+)\s*,/.exec(args)
    expect(
      first,
      `${where}: EventsOn must name its event as EVENTS.X so it can be classified`,
    ).not.toBeNull()
    const event = first![1]
    const handler = args.slice(first![0].length)
    out.push({
      key: `${rel}#${event}`,
      where,
      event,
      handler,
      scope: enclosingBody(code, m.index),
    })
  }
  return out
}

function filters(r: Registration): boolean {
  const inHandler = FILTER_SIGNS.some((re) => re.test(r.handler))
  if (inHandler) return true
  // A handler passed by name was declared beside the registration; the
  // predicate it uses is what to read.
  const byName = /^\s*[A-Za-z_$][\w$]*\s*$/.test(r.handler)
  return byName && FILTER_SIGNS.some((re) => re.test(r.scope))
}

describe('per-server scoping of event listeners', () => {
  const registrations = sourceFiles(src).flatMap(registrationsIn)

  it('classifies every event constants.ts declares', () => {
    for (const name of GLOBAL_EVENTS) expect(EVENTS).toHaveProperty(name)
    // A new event lands here as server-scoped until someone says otherwise,
    // which is the safe default: an unfiltered listener fails, a filtered one
    // passes.
  })

  it('sees the registrations', () => {
    expect(registrations.length).toBeGreaterThan(40)
    expect(new Set(registrations.map((r) => r.where.split(':')[0])).size).toBeGreaterThan(10)
  })

  it('filters every server-scoped event on its serverID, or says why not', () => {
    const problems: string[] = []
    const used = new Set<string>()
    for (const r of registrations) {
      if (GLOBAL_EVENTS.has(r.event as keyof typeof EVENTS)) continue
      if (filters(r)) continue
      if (r.key in GLOBAL_ON_PURPOSE) {
        used.add(r.key)
        continue
      }
      problems.push(
        `${r.where}: EVENTS.${r.event} is server-scoped and this handler never reads the payload's serverID. ` +
          'Filter on it (see usePlayers), or list the registration in GLOBAL_ON_PURPOSE with the reason.',
      )
    }
    expect(problems).toEqual([])
    const stale = Object.keys(GLOBAL_ON_PURPOSE).filter((k) => !used.has(k))
    expect(stale, 'GLOBAL_ON_PURPOSE entries that match no unfiltered registration').toEqual([])
  })
})
