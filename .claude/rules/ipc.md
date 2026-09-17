---
paths:
  - "frontend/src/**"
  - "app.go"
  - "backend/**"
---

# IPC conventions

The two short rules stay in `agent_docs/CLAUDE.md`, because they must hold
before any file is opened: **Go owns all side effects**, and **IPC goes through
the generated bindings only**, imported from `wailsjs/go/`, never raw
`window.go` or a string-based call. The rest is here.

## Shape

- Bind Go methods on the `App` struct in `app.go` at the repo root.
- Method names are `PascalCase` in Go and `PascalCase` in the generated TS.
- Always return `(T, error)` from a bound Go method.
- Re-run `wails generate module` after adding a bound method.

## Where errors are handled

Handle IPC errors where the data lives: a Zustand store or a per-tile hook
holds its own `loading`/`error` state, and its write actions rethrow after
recording the error so an optimistic UI can revert (see
`stores/useSchedulerStore.ts`). A shared `useWailsCall()` hook was tried and
removed: a store cannot call a React hook, which is where most fetching ended
up.

Swallowing a rejection with a bare `catch {}` is the thing to avoid. The
rethrow is only half the job, because a caller that ignores it is the same bug
one level up, so the caller reverts, keeps its editor open, or says why it
deliberately does neither.

**One sanctioned exception, or it gets "fixed" back.** The generated bindings
dereference `window.go`, so with no Wails backend *every* call throws, which is
the `frontend-dev` preset in `.claude/launch.json`, a browser-only preview with
no Go process. Reverting there would make it read-only. `lib/ipc.ts`'s
`hasWailsBridge()` separates the cases: no bridge keeps the optimistic value, a
bridge-present rejection reverts, records and rethrows. Reads are unaffected
and still degrade to defaults.

## Running is not reachable

Two different questions about a server, and UI that renders "nothing here"
needs both: `useServerStore`'s `status.running` (the server answered and is
stopped) and `reachable` (the backend answered at all). Hydrated once in `App`
by `hooks/useServerStatus.ts`. Do not re-tie that to a single tile's mount,
which is how five tiles once read a permanently stale `false`.

Do not use `useEffect` for data that should arrive on a Wails event listener,
and clean the listener up on unmount.
