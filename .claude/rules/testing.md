---
paths:
  - "**/*_test.go"
  - "frontend/src/**/*.test.ts"
  - "frontend/src/**/*.test.tsx"
  - "scripts/coverage-floor/**"
---

# Testing

Moved out of `AGENTS.md` so it costs no context until you open a test.

- Frontend: `vitest` + `jsdom` + `@testing-library/react`. Mock Wails bindings
  with `vi.mock('.../wailsjs/go/main/App')` rather than requiring a real
  bridge: see any `frontend/src/stores/*.test.ts`.
- Backend: standard `go test`, table-driven where it fits; use
  `httptest.Server` for HTTP clients.
- New logic (Go services, Zustand store logic, pure helpers) ships with tests.
- Both sides hold a coverage floor: `go run ./scripts/coverage-floor` for
  `backend/services`, `pnpm test:coverage` for `frontend/src`. Each is a
  ratchet: raise it as coverage rises, never lower it to make a build pass.
