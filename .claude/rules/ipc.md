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

## Per-server scoping

Three rules, one per layer, each held by a test that fails on the next
exception (#237):

- **A bound method that acts on a server takes its id and honours it.** The
  parameter is named `serverID`, or the request struct carries a `ServerID`
  field (`LoaderUpdateRequest`, `Graph`). `scoping_test.go`'s
  `TestBoundMethodsThatActOnAServerTakeItsID` reads `app.go` and fails on a
  method with neither unless it is in `serverlessMethods` with a reason: the
  layout, settings, updater, installer and provider lookups are the genuine
  cases. An entry stays only while its method still needs it.
- **An event about a server carries its id.** Map payloads use the key
  `serverID`; struct payloads are the `models.*Event` types with a `ServerID`
  field. `TestServerScopedEventPayloadsCarryAServerID` reads every `Emit` in
  `backend/services` and `app.go`, follows a payload variable to the literal
  that built it, and fails on a server-scoped event without one. Which events
  are global is `globalEvents` there: the installer's four (no server exists
  yet), the updater's, `commands:changed`, `schedule:notify` and
  `schedule:next-runs` (keyed by graph id, and a graph belongs to one server).
  A new `Event*` constant is server-scoped until listed.
- **A listener for a server-scoped event filters on it.** Read `serverID` off
  the payload, or go through `hooks/useServerStatus.ts`'s `isForActiveServer`.
  `lib/serverScoping.test.ts` scans every `EventsOn` under `src/` and fails on
  a handler that does neither unless the registration is in
  `GLOBAL_ON_PURPOSE` with the reason. App-wide notifications are the genuine
  cases: a crash on any server should be heard about. An absent or empty id
  means "applies here", never "drop it": `models/server.go` says why the empty
  id is real. And a store or hook that holds server data resets on switch,
  which `tiles/serverSwitch.test.tsx` proves per hook, each case confirmed to
  fail with its filter reverted.

The two test files mirror one classification, so a new event is filed in
both `globalEvents` and `GLOBAL_EVENTS` or in neither. Neither is a
`.claude/suite.json` invariant because the condition spans lines: an
invariant is a regex that must find nothing, and "this payload, wherever it
was built, has the key" is not one.

## Running is not reachable

Two different questions about a server, and UI that renders "nothing here"
needs both: `useServerStore`'s `status.running` (the server answered and is
stopped) and `reachable` (the backend answered at all). Hydrated once in `App`
by `hooks/useServerStatus.ts`. Do not re-tie that to a single tile's mount,
which is how five tiles once read a permanently stale `false`.

Do not use `useEffect` for data that should arrive on a Wails event listener,
and clean the listener up on unmount.
