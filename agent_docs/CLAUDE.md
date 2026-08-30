# Konnekt

A desktop Minecraft server dashboard built with Wails v2 + React + TypeScript.
Modular tile-based UI. Dark console aesthetic. Local-first, no cloud dependency.

## Stack

Wails v2 shell (Go backend, system WebView) with a React 19 + TypeScript +
Vite frontend, Tailwind v4, Zustand stores and a react-grid-layout tile grid.
pnpm for the frontend, Go modules for the backend.

## Project structure

- Repo root: `app.go`, `main.go`, `version.go` (Wails entrypoint, App struct,
  version).
- `backend/services/` holds process management, RCON, backups, scheduler,
  config, stats and updates; `backend/models/` holds structs auto-bound to TS.
- `frontend/src/` splits into `components/`, `tiles/` (one folder each, plus
  `registry.ts`), `stores/`, `hooks/`, `lib/`, `types/`, `assets/` and
  `styles/` — the last holds the **generated** token layer (see Code style),
  while the hand-authored component CSS stays in `style.css` beside it.
- `frontend/wailsjs/` is generated. Never edit it by hand.
- `website/` is the marketing site at konnekt.pages.dev: plain HTML, CSS and
  browser ES modules, no build step and no `package.json`. Cloudflare Pages
  watches this branch and deploys it, configured outside this repo, so there is
  no deploy workflow here and CI's `website` job is the only pre-merge gate.
  `website/tokens.css` is generated (see Code style). Serve it locally with the
  `website` preset in `.claude/launch.json`.

## Architecture rules

- **Tiles are self-contained**: each tile in `frontend/src/tiles/` owns its own
  data fetching, state, and rendering. No cross-tile dependencies.
- **Go owns all side effects**: process spawning, file I/O, RCON, scheduling.
  Never call OS-level operations from the frontend.
- **IPC via generated bindings only**: always import from `wailsjs/go/` — never
  use raw `window.go` or string-based calls.
- **One Zustand store per domain**: `useServerStore`, `useLayoutStore`,
  `useTileStore`, `useSchedulerStore`. Do not mix domains.
- **Go structs = TypeScript types**: define data shapes in `backend/models/`,
  Wails generates the TS equivalents automatically on `wails dev`.

## Tile system

Every tile is the same size, from `lib/gridSizing.ts`. To add one: create
`frontend/src/tiles/MyTile/index.tsx` + `types.ts`, then extend (never
restructure) `frontend/src/tiles/registry.ts`. No layout changes needed.

Why the grid is built the way it is, and which parts are load-bearing:
`.claude/rules/tile-system.md`, which loads on its own when you open a tile,
`gridSizing.ts` or `Dashboard.tsx`. Read it before changing placement code.

## IPC conventions

- Bind Go methods on the `App` struct in `app.go` (repo root)
- Method names: `PascalCase` in Go → `PascalCase` in generated TS bindings
- Always return `(T, error)` from bound Go methods
- Handle IPC errors where the data lives: a Zustand store or a per-tile hook
  holds its own `loading`/`error` state and its write actions rethrow after
  recording the error, so an optimistic UI can revert (see
  `stores/useSchedulerStore.ts`). A shared `useWailsCall()` hook was tried and
  removed: a store cannot call a React hook, which is where most fetching ended
  up. Swallowing a rejection with a bare `catch {}` is the thing to avoid.
  The rethrow is only half the job — a caller that ignores it is the same bug
  one level up, so the caller reverts, keeps its editor open, or says why it
  deliberately does neither.
- **One sanctioned exception, or it gets "fixed" back.** The generated bindings
  dereference `window.go`, so with no Wails backend *every* call throws — which
  is the `frontend-dev` preset in `.claude/launch.json`, a browser-only preview
  with no Go process. Reverting there would make it read-only. `lib/ipc.ts`'s
  `hasWailsBridge()` separates the cases: no bridge keeps the optimistic value,
  a bridge-present rejection reverts, records and rethrows. Reads are unaffected
  and still degrade to defaults.
- Two different questions about a server, and UI that renders "nothing here"
  needs both: `useServerStore`'s `status.running` (the server answered and is
  stopped) and `reachable` (the backend answered at all). Hydrated once in
  `App` by `hooks/useServerStatus.ts` — do not re-tie that to a single tile's
  mount, which is how five tiles once read a permanently stale `false`.
- Re-run `wails generate module` after adding new bound methods

## Code style

- Functional components only, no class components
- `import type` for type-only imports
- No `any` — use `unknown` and narrow
- Prefer named exports; default export only for page-level components
- Styling via Tailwind utilities backed by the CSS-variable token system
  (`frontend/src/styles/tokens.css` `@theme` blocks + `frontend/src/lib/theme.ts`
  `applySkin()`). Inline `style={{}}` is reserved for genuinely dynamic/computed
  values (animation delays, transforms, react-grid-layout position props) — not
  for static styling. `eslint.config.js`'s `no-restricted-syntax` rule enforces
  this as `error` across every source file that ever carried an inline style
  (Milestone 2, closed — see `agent_docs/HEALTH_CHECKLIST.md`).
- **Icons come from `components/ui/Icon.tsx`**, never a literal glyph (`×`, `⚙`,
  `✓`) and never a hand-pasted `<svg>`. Do not reach for a Unicode glyph: a font
  positions each one by its own metrics, so ⚙ ✎ ⤢ × could not be made to line up
  with each other under any amount of padding, and some of them resolve to an
  emoji font on one platform and a symbol font on the next.
  The glyph is passed to `Icon` as a component, sourced from
  `frontend/src/lib/icons.ts` — the only module in the app allowed to import
  `lucide-react`, so the icon set is swappable from one file and
  `pnpm check-bundle` has one place to read. Adding an icon is a name added to
  that file's import and export, taken from https://lucide.dev/icons. This
  replaced a hand-drawn 16x16 set (`components/ui/icons.tsx`, deleted): it
  solved the alignment problem correctly, but every new icon was path data
  somebody had to draw, and lucide ships the same ink already centred on a
  24-unit grid.
  `Icon` sizes through Tailwind's spacing scale (`size-3` … `size-5`, an
  `xs`/`sm`/`md`/`lg` prop) and never sets a colour: lucide strokes
  `currentColor`, so a `text-*` token on the icon or an ancestor themes it,
  `applySkin()` retheming included — which is what lets `IconButton`'s hover
  rule still drive the icon inside it. Stroke weight is one screen value,
  `ICON_STROKE_PX`, held constant across sizes by lucide's
  `absoluteStrokeWidth`; it is not a design token because `tokens.source.json`
  is vendored from kollektiv and a Konnekt-only value there is reverted on the
  next sync.
- **A control's icon goes inside `components/ui/IconButton`**, the one square box
  the whole navbar column shares — it carries the hit area, the hover
  background, the tone, and the accessible name. The icon itself stays
  `aria-hidden`, so nothing is announced twice. `Icon`'s `label` prop is for the
  rare icon that carries meaning alone, outside a labelled control (see
  `ActiveProcesses`'s outcome glyph). Not every `×` is an `IconButton`: the
  small one that clears a search field or drops a chip lives in a dense row at
  its own scale, where a 24px box would set the row's height.
- **Token values are not edited here.** `frontend/src/styles/tokens.css`,
  `frontend/src/styles/tokens.ts` and `website/tokens.css` are generated by
  `pnpm gen:tokens` from `tokens.source.json`, which is vendored from
  `kollektiv/design/tokens.json` — the suite's shared source, also consumed by
  Kommands. To add or change a token, edit it there, run kollektiv's
  `scripts/sync-tokens.sh`, then regenerate and commit all three files. A hand edit
  is reverted on the next run and never reaches the other product.
  `frontend/src/style.css` keeps the hand-authored component CSS and nothing else.
  `website/tokens.css` is the same values as plain `:root` custom properties for the
  marketing site, which has no Tailwind and no build step; every page links it ahead
  of `/styles.css`, and `website/styles.css` keeps only the page vocabulary that is
  not a token (`--max-width`, `--nav-h`, `--section-y`).
- Go: `gofmt` enforced, errors always handled (no blank `_` ignores)
- Backend diagnostics go through `log/slog`'s package-level functions
  (`slog.Error("scheduler: write history", "error", err)`), never `fmt.Printf`
  or `println`. `main()` points the default logger at `konnekt.log` in the app
  data dir via `services.InitLogger`, because a packaged build has no terminal
  and anything on stdout is lost. `EventBus` emissions are the UI's channel, not
  a log: they die with the window. Writes to a *server process's* stdin
  (`fmt.Fprintln(s.stdin, ...)`) are not diagnostics and stay as they are.
- Heavy per-tile dependencies are lazy-loaded via `React.lazy` + `Suspense`
  (see `frontend/src/tiles/worlds/index.tsx`): three.js, recharts, `@xyflow`
  (scheduler editor), CodeMirror (config editor) and the react-markdown/parse5
  pipeline (mod descriptions). Keep the entry bundle under the 165 KB gzip
  budget enforced by `pnpm check-bundle`. A new lazy chunk belongs in
  `lib/prefetch.ts`'s warm list too, spelled with the same specifier — that
  file is what makes the first open of a tile cheap, and it warms one chunk per
  idle slot and never while the user is interacting. `pnpm check-prefetch`
  enforces that pairing; a specifier that drifts resolves to a second copy of
  the module and warms nothing, with no other symptom.

## Build & dev commands

```bash
wails dev             # Hot-reload dev mode (runs Vite + Go together)
wails build           # Production binary
wails generate module # Regenerate TS bindings after Go changes
pnpm typecheck        # tsc --noEmit (run from frontend/)
pnpm lint             # ESLint (run from frontend/)
pnpm test             # vitest (run from frontend/)
pnpm format           # Prettier --write (run from frontend/)
pnpm format:check     # Prettier --check, the gate CI runs (from frontend/)
pnpm check-bundle     # Enforce 165 KB gzip entry-chunk budget (run from frontend/)
pnpm check-tokens     # Assert every token-named class compiles (run from frontend/)
pnpm check-prefetch   # Assert every lazy tile chunk is in the warm list (frontend/)
pnpm gen:tokens       # Regenerate the token layer from tokens.source.json (frontend/)
pnpm format:website   # Prettier --check over website/ (run from frontend/)
node scripts/check-website-links.mjs   # website hrefs/assets/sitemap (repo root)
go vet ./...          # Go static analysis (repo root — single module)
go test ./...         # Go tests (repo root)
```

Always run `pnpm typecheck`, `pnpm lint`, and `go vet ./...` after a series of
changes. A lefthook pre-commit hook already runs Prettier + ESLint +
`tsc --noEmit` on staged frontend files and `gofmt` + `go vet` on staged Go
files; CI (`.github/workflows/ci.yml`) re-runs typecheck/lint/build/test on
every push and PR.

**Definition of done:** run `/suite-kit:health` — it runs the gates above plus
this repo's generated-file check, driven by `.claude/suite.json`, and reports a
table. Then sanity-check the area you touched against the four pillars in
`agent_docs/HEALTH_CHECKLIST.md` (Clean / Stable / Scalable / Performant), and
confirm the change is in scope for the current milestone per
`agent_docs/ROADMAP.md` (Alpha vs Beta — do not scaffold Beta features during
Alpha). Track any gap you can't fix now under that checklist's `Open backlog`.

## Task tracking

Task tracking is **GitHub Issues**. Do not add a `TODO.md`.

`agent_docs/ROADMAP.md` holds direction and sequencing; individual work items are
issues.

Linear is a **downstream mirror**. `/suite-kit:suite-sync` writes it, mirroring
this repo's GitHub Issues into the Apps team's Konnekt project and matching on a
`Source: kollektiv-mc/konnekt#<number>` line in the Linear issue description
rather than on titles. Never write to Linear directly from this repo.

### Labelling an issue

Three labels, always: one `type:`, one `area:`, one `p0`-`p3`. Add a
`milestone:` once the work is staged. Its absence means nobody has staged it,
not Later.

`type:` uses the same ladder as a pull request (below). `p0`-`p3` is the suite's
scale, defined in kollektiv's `docs/conventions.md`, and a repo does not invent
its own. `area:` is one of the per-area labels in `.github/labels.yml`, matching
the issue forms' "Which part of Konnekt?" dropdown. Prefer a specific area over
`area:ui`: the suite defines that one so it still exists, but "user-facing
interface work" describes nearly every issue in this repo and so sorts nothing.

The area label is load-bearing rather than decoration. `website/roadmap.js`
files each issue into a folder by it.

### Issue titles

**Name the thing, do not describe the change.** An issue title is a leaf in a
tree under a folder that already says which area it belongs to, so the area does
not belong in the title as well.

- No `in the X tile` suffix, no `X tile:` prefix, no `X — thing`.
- A short noun phrase. If it reads as a sentence, it is too long.
- No em dashes.

| Instead of | Write |
| --- | --- |
| Make the scheduler minimap resizable | Resizable minimap |
| Add a floating node manager panel to the scheduler editor | Floating node manager panel |
| Show past-session server logs in the console tile | Past-session logs |
| Render real terrain previews in the Worlds tile | Terrain previews |

This is deliberately **not** the pull request rule below, which is imperative
mood. A merged pull request title is a release-notes line and has to read as a
sentence about what shipped; an issue title is an index entry. Different
surface, different grammar, and the difference is on purpose.

What went wrong without this: the area had nowhere to live except the title, so
fifteen consecutive scheduler issues each said "scheduler" in theirs, and three
competing shapes were in use at once (`thing in the X tile`, `X tile: thing`,
`X — thing`). Across the 32 issues not filed through a form, titles averaged 8.2
words and 24 of them named their own area.

## Commits & pull requests

Merged PR titles become the release notes, so a title is public copy, not a
note to a reviewer.

- **Title:** imperative mood, sentence case, no trailing period, one line.
  Say what changed, not which files moved: "Support NeoForge and modern Forge
  servers", not "Update serverlaunch.go".
- **No em dashes** in titles, bodies or commit messages. Use a comma, a colon,
  or two sentences. Keep the prose plain and short.
- **Label each PR** `type:feature`, `type:bug`, `type:docs` or `type:chore`.
  Required, and CI's `pr-labelled` job fails a PR without one. The label is the
  *only* input to the section: the title is never read at all, by a verb, a
  `feat:` prefix or anything else. `type:chore` and `type:docs` are counted in
  a footer line rather than listed, because they changed nothing a user can
  observe. `changelog:skip` leaves a PR out entirely, and does not replace a
  `type:` label.

**Which `type:` label.** Ask these in order and stop at the first yes:

1. **Can a user of Konnekt tell the difference?** If nothing they can see, run
   or click changed, it is `type:chore`, or `type:docs` for documentation and
   nothing else. Refactors, tests, CI, tooling and dependency bumps stop here,
   however large the diff.
2. **Was Konnekt already meant to do this, and not doing it?** Then it is
   `type:bug`. That covers anything the UI offers, the docs describe or the app
   plainly implies, including things that fail silently.
3. **Otherwise it is `type:feature`:** the app can now do something it never
   offered.

The size of the diff is not the test, and this is where it goes wrong: a repair
that needed a new file, a new bound method and a new row of UI is still
`type:bug`. #97 "Write a log file a bug reporter can attach" was filed as a
feature on exactly that reasoning, and it was wrong. The app was already
writing diagnostics, a packaged build with no terminal was throwing them away,
and the change is the repair; the Settings > About row exists so the fix is
usable, which makes it part of the fix. When the ladder feels ambiguous, revert
the change in your head and ask what the user loses: something goes back to
being broken is `type:bug`, they lose something they never had is
`type:feature`, they cannot tell is `type:chore`. A change that is honestly
half repair and half new capability is two PRs. Full version, with the rest of
the cases, in `CONTRIBUTING.md`.
- **Body:** why the change exists and how it was verified. It never reaches the
  notes, so detail is free.
- Commit messages follow the same rules. Nothing parses them.

**Keep one PR to one concern.** The notes list a merged PR once, under one
heading, by its title, so a PR that carries a feature *and* a website pass *and*
a CI tweak cannot be described honestly by any single line. Every bad entry in
the first release window came from this: "Close Milestone 2, add a coverage
floor, and polish the snapshot channel across the website" is three changes, and
its title is public copy for none of them. Split it, or accept that it will be
filed as a chore.

**What reaches the notes at all.** `.github/scripts/release-notes.py` builds
them, and drops any PR whose files are all under the prefixes in
`.github/changelog.json` — `website/`, `docs/`, `agent_docs/`, `.github/`,
`.claude/`, `scripts/` and the root repo furniture. None of that ships in the
binary. Note `README.md` is on that list and `build/` is not: a one-line README
edit used to be enough to pull an all-website PR into the notes, while `build/`
holds the app icon and RPM spec, which do ship. The classifier's rules are
suite-wide and live in the script; the path list is Konnekt's own and lives in
that config. Both are covered by `.github/scripts/release-notes_test.py`.

## Local tooling

- **graphify** — the AST knowledge-graph tool this repo's Claude Code setup is
  built around. `.claude/settings.json` registers PreToolUse hooks that nudge
  toward `graphify query`/`explain`/`path` before raw source reads/greps (see
  the root `CLAUDE.md` graphify rules). Install it so `graphify` is on your
  `PATH` (e.g. `pipx install graphify` or `pip install --user graphify`), then
  run `graphify update .` to generate `graphify-out/` — gitignored and
  regenerable, AST-only, no API cost. Without graphify installed the hooks
  simply no-op (a harmless per-call notice; nothing blocks). Re-run `graphify
  update .` after code changes to keep the graph current.
- **`.claude/` config is committed** (`settings.json` hooks + `launch.json`
  dev-server presets) so every clone and cloud agent inherits the same setup;
  only `.claude/settings.local.json` (the personal permission allowlist) is
  gitignored.

## Testing

- Frontend: `vitest` + `jsdom` + `@testing-library/react`. Mock Wails
  bindings with `vi.mock('.../wailsjs/go/main/App')` rather than requiring a
  real Wails bridge — see any `frontend/src/stores/*.test.ts` for the pattern.
- Backend: standard `go test`, table-driven where it fits; use
  `httptest.Server` for HTTP clients (see `update_test.go`, `modrinth_test.go`).
- New logic (Go services, Zustand store logic, pure helpers) should ship with
  tests.

## Versioning & releases

`version.go`'s `Version` var is the single source of the app version. Tagged
releases, the nightly snapshot channel and the Linux build tags are covered in
`.claude/rules/builds-and-releases.md`, which loads when you open a workflow,
`version.go`, `wails.json` or anything under `build/`.

## Alpha scope — do not implement beyond this

See `agent_docs/ROADMAP.md` for full breakdown.

Alpha: multi-server management, start/stop/restart, live console, real-time
stats, performance history (1h), player list + kick/ban, quick commands +
custom commands, scheduled tasks, world management, manual + scheduled backups,
server.properties editor, tile layout system (drag/resize/snap/crate/presets
with save/restore), notifications.

Beta features (file explorer, audit log, mod manager, player profiles, skin
previews, extended history) are in `agent_docs/ROADMAP.md` — do NOT scaffold
during alpha.

## Do not

- Do not edit files under `frontend/wailsjs/` — they are auto-generated
- Do not call OS or filesystem operations from frontend TypeScript
- Do not use `localStorage` or `sessionStorage` — persist via Go file I/O
  writing JSON to the Wails app data directory
- Do not add new Go dependencies without checking `agent_docs/DEPENDENCIES.md`
- Do not restructure `frontend/src/tiles/registry.ts` mid-feature — extend
  only. (Two sanctioned, one-time exceptions while the tile grid's placement
  model was under active repair — see HEALTH_LOG.md: loose per-tile
  `defaultW`/`defaultH`/`minW`/`minH` numbers became an `sm`/`md`/`lg` bucket
  shape, then that shape was removed outright in favor of every tile sharing
  one size from `lib/gridSizing.ts`. A `TileDefinition` entry is now just
  `{ id, label, icon, maximizable?, component }` — the rule applies fully
  from that shape going forward.)
- Do not use `useEffect` for data that should come from a Wails event listener