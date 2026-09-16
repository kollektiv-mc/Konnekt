---
paths:
  - "backend/**"
  - "app.go"
  - "main.go"
---

# Go backend conventions

`gofmt` is enforced, and errors are always handled: no blank `_` ignores. The
`no discarded errors` invariant in `.claude/suite.json` greps for the
`x, _ := f()` form as well, since an error in the second return position is not
`_ = ` and went unnoticed for two months. A deliberate discard carries a
trailing `//nolint:errcheck // reason` on the same line.

Diagnostics go through `log/slog`'s package-level functions
(`slog.Error("scheduler: write history", "error", err)`), never `fmt.Printf` or
`println`. `main()` points the default logger at `konnekt.log` in the app data
dir via `services.InitLogger`, because a packaged build has no terminal and
anything on stdout is lost.

`EventBus` emissions are the UI's channel, not a log: they die with the window.
Writes to a *server process's* stdin (`fmt.Fprintln(s.stdin, ...)`) are not
diagnostics and stay as they are.

Data shapes live in `backend/models/`, and Wails generates the TypeScript
equivalents on `wails dev`. New logic ships with tests, and
`backend/services` holds a coverage floor (`go run ./scripts/coverage-floor`)
that is raised as coverage rises and never lowered to make a build pass.
