# Konnekt Slop Audit (2026-09-08)

A dated snapshot, like `CONVENTION_AUDIT.md`: it records what was true on
2026-09-08 against an externally written "AI slop audit brief" and is not kept
current. The evergreen gate set stays in `HEALTH_CHECKLIST.md`; anything here
worth holding on to should move there as a checklist line or a backlog item,
not be re-read from this file.

Every finding is labelled **[T]** (tool output, reproducible from the command
shown) or **[J]** (judgment). Run in a cloud container on commit `00f90f6`
(main as of 2026-09-07). Tools the container could not run are listed with the
exact command to run locally; nothing was silently skipped.

## 0. The brief against the repo

The brief describes five failure modes and prescribes a tool per mode. Before
running any of it, the honest first question is how much of it the repo
already does. Answer: about half, and the half it does is the half that is
automated.

| Brief section | Already in place | Gap |
| --- | --- | --- |
| §1 dead code | `HEALTH_CHECKLIST.md` "no obviously dead code" prescribes exactly `deadcode ./...` and `staticcheck -checks=U1000` under both `GOOS`es, and the sweep ran 2026-08-19 (HEALTH_LOG). | Manual, not in `suite.json`, so it drifts between sweeps (see §1 below: three orphans from a 2026-08-30 refactor). No frontend equivalent to `knip`; the checklist's "build the import graph by hand" is what knip does in one command. |
| §2 duplication | Nothing automated. HEALTH_CHECKLIST's backlog names two specific duplicates (`classifyLine` vs `reServerReady`, the hover handlers). | No `jscpd` or equivalent has ever run. |
| §3 pattern consistency | `CONVENTION_AUDIT.md` (2026-07-18) did this once by hand; the checklist's Stable pillar verifies the store-rethrow rule and the `EventsOn` cleanup rule with greps. | Go error-wrapping style and per-tile fetch shape have never been compared side by side. |
| §4 test quality | Two coverage floors (Go 49%, frontend 50%) are gated. HEALTH_LOG records mutation-*checking* by hand on two occasions (2026-08, `backup.go` guard tests). The checklist itself says "coverage is a proxy, not the goal". | No mutation tool has run. `deadcode -test` is not in the sweep. |
| §5 complexity | Nothing. | No `gocyclo`, no ESLint `complexity`/`max-lines-per-function`. |
| §6 security | `SECURITY.md` names the threat model (self-updater, path handling, RCON). Path-traversal, zip-slip, symlink-escape and checksum tests exist and are named in the checklist. HEALTH_LOG shows `//nolint:gosec` reasoning on `math/rand`. | `gosec` and `govulncheck` have never run as a gate. |
| §7 doc drift | The checklist's Clean pillar has a "docs still match" item with a verify recipe, and the health log shows it catching real drift (Kommands roadmap text, 2026-08-19). | Two drifts found below that the recipe does not reach. |

Two things in the brief are wrong or inapplicable, and one is worth pushing
back on:

- **Its "fresh context, do not read design docs" ground rule** conflicts with
  the repo's own `CLAUDE.md` auto-load and `graphify` hooks. Followed
  literally it produces an auditor that re-derives what `HEALTH_LOG.md` already
  records, and then reports it as new. This audit read the health docs *after*
  the tool runs, which is the version of that rule that survives contact with
  a repo that keeps a log.
- **Its Modrinth framing does not apply to Konnekt.** The rule it cites is
  real: Modrinth's Content Rules now ban projects "entirely or primarily
  comprised of" generative-AI output and require a "Contains AI-generated
  content" disclosure for substantial AI involvement, with a grace period to
  2026-09-27 ([Modrinth news](https://modrinth.com/news/article/ai-policy-and-disclosures/),
  [Content Rules](https://modrinth.com/legal/rules)). The container's egress
  proxy blocks modrinth.com, so this is from the search summary, not the page;
  read it before relying on the wording **[J]**. But Modrinth hosts mods,
  plugins, datapacks, shaders, resource packs and modpacks; Konnekt is a desktop
  application that *consumes* Modrinth's API and is not a project type Modrinth
  lists **[J, from memory of the project-type list; not re-verified online]**.
  The disclosure question is still worth answering honestly, and `README.md:16`
  already answers it: "Most of the code comes from Claude, with me reading over
  its shoulder." The verdict section below is written against that sentence,
  not against a hosting policy.
- **`ts-prune` is archived and `knip` replaces it** is correct. **"golangci-lint
  bundles staticcheck but not deadcode"** is correct. `golangci-lint` v2 is
  preinstalled in the cloud container and is not used by this repo at all,
  which is a cheap win noted in §8.

## 1. Tool results

| Check | Tool | Status | Findings |
| --- | --- | --- | --- |
| Go unused identifiers | `staticcheck ./...` (linux and `GOOS=windows`) | ran | 3: `loader.go:140` ST1005 (capitalised error string, it is the product name, deliberate **[J]**); `server_state_test.go:331` SA4006 (assigned `events` never read); `serverinstance.go:121` U1000 `job` unused on linux only, the documented false positive (HEALTH_LOG 2026-08-19). |
| Go unreachable from `main` | `deadcode ./...`, `GOOS=windows deadcode ./...`, `deadcode -test ./...` | ran | 0, 0, 0. |
| Frontend unused files/exports/deps | `pnpm dlx knip` (no `knip.json`) | ran | 1 unused file, 2 unused exports, 3 unused icons, 2 unused dependencies. 65 of its 71 "unused exports" are under `wailsjs/` (generated, ignore) and `playwright` is a false positive (`demo/record.mjs` requires it from outside `frontend/`). Detail in §2. |
| Duplication | `pnpm dlx jscpd --min-lines 8` over Go, TS, TSX, JS | ran | 372 files, 93 clones, 1.58% duplicated lines. Excluding tests, demo and scripts: 20 Go clusters (242 lines) and 32 TS/TSX clusters (494 lines). Detail in §3. |
| Go complexity | `gocyclo -over 15 .` | ran | 18 non-test functions over 15. Top five: `worldsFromServerZip` 35 (`backup.go:666`), `readPayload` 35 (`nbt.go:137`), `ListConfigFiles` 35 (`config_editor.go:60`), `identifyUnknownLocked` 33 (`modidentify.go:130`), `simulateNode` 30 (`scheduler_preview.go:137`). |
| TS complexity | ESLint `complexity: 15`, `max-lines-per-function: 200`, layered on the repo config | ran | Non-test: 23 functions over complexity 15, 18 over 200 lines. Top: `BackupsTileExpanded` complexity 42 / 379 lines (`tiles/backups/index.tsx:305`), `GraphEditorInner` 780 lines (`scheduler/editor/GraphEditor.tsx:98`), `App` 453 lines, `Dashboard` 411 lines, `WorldHud` and `BlockNode` complexity 34. |
| Go security lint | `gosec ./...` | ran | 104 findings, none high. By rule: G104 unhandled error 26, G304 file-from-variable 25, G115 integer conversion 21, G301/G302/G306 permissions 19, G204 subprocess-from-variable 6, G404 `math/rand` 5, G110 decompression bomb 1, G122 1. Detail in §5. |
| Go vulnerable deps | `govulncheck ./...` | **blocked** | The container's proxy returns 403 for `vuln.go.dev`. Run locally: `go install golang.org/x/vuln/cmd/govulncheck@latest && govulncheck ./...`. |
| Go mutation testing | `go-mutesting` (jonbaldie v2) on `rcon.go` and `scheduler_validate.go` | ran, sampled | See §4. The full package is 1,992 mutants for eight files alone (`--dry-run`), roughly 30 minutes at 4 workers, so two high-coverage files were chosen as the sample. Run the rest locally: `go install github.com/jonbaldie/go-mutesting/v2/...@latest && go-mutesting --quiet --no-diffs ./backend/services/<file>.go`. |
| TS mutation testing | `@stryker-mutator/core` 10 + vitest runner via `pnpm dlx` | **failed to start** | The `dlx` sandbox resolves `typescript` 6 and Stryker's tsconfig preprocessor calls a removed API. Run locally: from `frontend/`, `pnpm add -D @stryker-mutator/core @stryker-mutator/vitest-runner`, then `pnpm exec stryker run` with `{"testRunner":"vitest","mutate":["src/stores/**/*.ts","src/lib/**/*.ts","!**/*.test.ts"]}`. Do not commit the devDependencies without a `DEPENDENCIES.md` line. |
| Manual pattern review | three read-only agent passes over Go, security and frontend | ran | §3 and §5. |

## 2. Dead code and unused surface **[T]**

| File | What | Origin **[J]** |
| --- | --- | --- |
| `frontend/src/tiles/scheduler/SchedulerSummaryCard.tsx` | whole file, imported by nothing | Left behind by `b74db22` (2026-08-30, "Roll every tile's summary up into an Overview tile"), eleven days *after* the 2026-08-19 dead-code sweep. Abandoned generation, not future API. |
| `frontend/src/tiles/performance/PerformanceSummary.tsx:97` `PerformanceSummaryCard` | exported function, zero references | Same commit, same story. Its doc comment at `:39` still points readers to it as "the connected form". |
| `frontend/src/tiles/worlds/WorldsSummary.tsx:83` `WorldsSummaryCard` | exported function, zero references, `_props` unused | Same. |
| `frontend/src/lib/icons.ts:34,46,54` `SquareActivity`, `SlidersHorizontal`, `RotateCcw` | re-exported, never rendered | Harmless (tree-shaken, `sideEffects: false`) but `DEPENDENCIES.md` says "the 20 in use", so the count there is stale by three. |
| `frontend/package.json:34,38` `@react-three/postprocessing`, `postprocessing` | dependencies never imported | `git log -S` finds **no commit in which `frontend/src` ever imported either**. Added with the worlds scene in `aa4f079` and never used. `DEPENDENCIES.md:100` lists them as part of the lazy-loaded scene, which is false. Removing them also removes whatever transitive weight they pull into the lockfile. |

`CATEGORY_ORDER` (`scheduler/editor/blockMeta.ts:1`) is flagged by knip but used
inside its own file; the `export` is what is dead, not the constant.

Go side: nothing. `deadcode` is clean in all three modes and the one U1000 hit
is the documented per-OS false positive. That is the difference between a
check that has been run three times by hand and one that has never run: the
Go sweep held, the frontend one did not survive the next refactor.

## 3. Duplication and pattern inconsistency

### 3a. Duplicate clusters worth extracting **[T for the clone, J for the verdict]**

| Cluster | Lines | Verdict |
| --- | --- | --- |
| `tiles/backups/ServerInfoPanel.tsx` vs `WorldInfoPanel.tsx` (6 clusters: 5, 31, 36, 57, 74, 197 vs 3, 26, 50, 69, 101) | 96 | Same panel written twice with a different subject. Extract. |
| `components/QuickCommandsPanel.tsx` vs `tiles/quick-commands/library/CommandLibrary.tsx` (108/75, 131/116, 328/325) | 49 | Two generations of the same feature both still mounted. The mtime and the location say the tile one is newer; the component one is likely the tombstone. Decide which survives. |
| `tiles/mods/BrowsePanel.tsx:71` vs `InstalledPanel.tsx:71` (36 lines) and `BrowsePanel.tsx:79` vs `scheduler/editor/GraphEditor.tsx:761` | 51 | Three hand-rolled dropdown menus with the same `Popover` + button list + `onMouseEnter` style write + literal `✓`. A `Menu` component under `components/ui/` is the fix, and it removes eight literal glyphs (`BrowsePanel.tsx:94,143,165`, `InstalledPanel.tsx:94,157,185`, `GraphEditor.tsx:779,787`) that the "icons come from `Icon`" rule forbids. |
| `tiles/backups/BackupsSummary.tsx:16,89` vs `tiles/backups/index.tsx:336,723` | 35 | The summary card re-implements the tile's empty/running states. Extract or have the summary import them. |
| `App.tsx` 161/463, 191/262, 462/481, 463/506 | 68 | Four near-identical `EventsOn` effects inside one 453-line component. A `useServerEvent(name, handler)` hook collapses them. |
| `backend/services/backup.go` 119/208, 368/441, 388/459, 405/477, 509/546 | 67 | The server-backup and world-backup paths are the same code twice. HEALTH_LOG already knows this area (2026-08 guard tests). Extract a `backupTarget` helper. |
| `backend/services/scheduler_triggers.go` 83/119/150/244, 98/130, 289/319, 318/343 | 95 | Trigger matching boilerplate per trigger kind. Borderline: a table-driven shape would remove it, but each branch is short and readable. Leave unless a fifth trigger arrives. |
| `backend/services/config_editor.go` 94/153, 130/170 | 20 | The plugins-dir and config-dir walks. Same function twice; the 35-complexity `ListConfigFiles` is this duplication. |
| `stores/useTileStore.ts:44,60`, `tiles/config/FileList.tsx` (4 intra-file), `mods/useGridPageAnimation.ts:295,319`, `worlds/WorldHud.tsx` | small | Coincidental or a two-branch symmetry; not worth a helper. |

### 3b. Inconsistent patterns **[T counts, J on the dominant pattern]**

**Go error wrapping.** 179 `fmt.Errorf` (92 `%w`, 30 constant-string), 16
`errors.New`, 241 bare `return err`. Dominant: wrap with `%w` at a boundary
(network, file, jar), bare pass-through inside. Two idioms for a constant
message coexist: `errors.New` in `worlds.go` (7), `backup.go` (4),
`config_editor.go:398`; `fmt.Errorf("const")` in `scheduler_blocks.go` (8),
`scheduler_expr.go` (7), `installer.go`, `loader.go`, `server.go`, `rcon.go:46`.
Files that never wrap: `backup.go` (0 of 41), `config.go` (0 of 12), `nbt.go`
(2 of 27). Files that wrap nearly everything: `loader.go`, `update.go`,
`modrinth.go`, `atomicwrite.go`.

**Swallowed errors the checklist cannot see.** The Clean pillar's verify grep
is `grep -rn "_ = "` and it returns 0. A grep for `, _ :=` returns **40**
non-test sites outside `//nolint` that discard an error from a call
(`backup.go:117,207`, `config_editor.go` ×12, `modservice.go` ×12,
`loader.go:151,307,439`, `worlds.go:169,211`, `server.go:484`,
`modrinth.go:384`, `scheduler_blocks.go:467`, `scheduler_triggers.go:309,310`,
`serverlaunch.go:47,293`, `installer.go:203`, `modjar.go:530`,
`modidentify.go:135,211`). Most are "degrade to default" by design (a
`ReadDir` inside a listing), which is exactly what the nolint'd sites in
`players.go:45` and `server.go` document and these do not. Same intent, two
conventions, and the checklist line is marked done against a grep that sees
one of them.

**Wails-bound methods.** 93 exported methods on `App`, all return an error
(52 `(T, error)`, 41 bare `error`), all one-line pass-throughs, no
log-and-swallow. Deviations: `app.go:479-575,607` read and unmarshal JSON
files directly, against the comment at `:423` that says app.go does no file
I/O; `app.go:657` `RefreshKommands` returns a value *and* an error;
`app.go:463-474` format untrusted `name`/`reason` into a console line (§5).

**RCON.** One path, `RconService.Execute` (`rcon.go:29`): dial 2s, 5s
deadline, connect-auth-send-close per call, no reconnect, no retry, no
`context`. Consistent by omission. Two "send a command" mechanisms exist,
stdin and RCON: the UI always uses stdin, the scheduler exposes both as
blocks, backup quiesce prefers RCON and falls back, the TPS poll is RCON-only
and drops errors silently (`server.go:954-1035`). `PlayerService.rcon` is
"reserved" and has zero uses (`players.go:15`). `rcon.go:35` `SetDeadline`'s
error is the only unchecked one in the package.

**Locking.** Dominant is "lock, snapshot, unlock, then I/O", with the order
documented at `server.go:330`. Lock held across I/O: `modservice.go:206,609,673,929`
hold `s.mu` across Modrinth calls and the download (documented as
"serializes installs", but it also blocks `Rescan`/`SetEnabled` for the length
of a download); `server.go:1040,825` write to the child's stdin under `s.mu`.

**Interfaces.** All four single-implementation interfaces (`ModProvider`,
`LoaderProvider`, `loaderInstaller`, `serverGuard`) have a test fake. None is
speculative abstraction.

**Frontend fetch shape.** Dominant: a per-tile `useXxx` hook with `useState`
for data/`loading`/`error`, bindings called directly in `try/catch`,
`EventsOn` for refresh. Deviations: `tiles/config/ConfigSummary.tsx:193-220`
fetches inline in the component; `usePerformanceHistory.ts:22` and
`useBackupWorlds.ts:26` have no error surface; `useWorlds.ts` write actions
have no catch and rely on `WorldHud.tsx:69` to catch. Three error-to-string
spellings coexist: `errMsg(e)` (stores), `String(e)` (`useMods`,
`ConfigSummary`, `WorldHud`), bare `catch {}` plus a flag (`usePlayers`).

**Store write actions** against the `useSchedulerStore` reference: four stores
share the "revert + record + rethrow only if `hasWailsBridge()`" shape;
`useCommandsStore.ts:125` spells the same thing as an early return;
`useCommandsStore.ts:224` `.catch(console.error)` swallows;
`useLayoutStore.ts:57` `persistActiveLayout` records and never rethrows, so
its callers cannot revert, which is the bug the IPC convention names.

**Offline branching.** Both `status.running` and `reachable`: console,
overview, players (via its own `reachable`). `running` only: backups, config,
mods, worlds. Neither: scheduler, performance, notifications, quick-commands.
Players computes its own `reachable` from its roster call rather than reading
`useServerStore.reachable`, so it can disagree with the status band.

**`EventsOn`.** 50 sites, all released in an effect cleanup **[T, per file]**.
Five spellings, not the three the checklist says (single `cleanup`, single
`off`/`cancel`, numbered `c1..c6`, named `offX`, array `offs[]`). One outlier:
`hooks/useCommandsSync.ts:30` is the only site with no `try/catch` around
`EventsOn`, so in the no-bridge preview it throws at mount where the other 49
do not.

**Hover styles.** 138 `.style.<prop> =` assignments in 27 files, nearly all
`onMouseEnter`/`onMouseLeave` pairs that route around the inline-style lint
rule. Already in the checklist backlog as #279; the count there (about 130 in
24) is close enough. Listed here only because it is the single most
"separate context window" pattern in the tree: the same hover written 70
times by hand, three of them since converted to `hover:` classes and the
rest not.

## 4. Test quality

### 4a. Mutation score, sampled **[T]**

`go-mutesting --quiet --no-diffs ./backend/services/rcon.go ./backend/services/scheduler_validate.go`,
148 mutants after deduplication, 4 workers, about 12 minutes:

| File | Line coverage | Mutation score | Escaped | Gap |
| --- | --- | --- | --- | --- |
| both files | | **66.2%** (98 killed, 50 escaped, 0 uncovered) | 50 | |
| `rcon.go` | 94.0% | about 64% **[J, from the 122:67 pre-dedup split; the tool reports one score]** | 35 | about 30 points |
| `scheduler_validate.go` | 91.3% | about 71% | 15 | about 20 points |

That is the gap the brief predicts, on the two best-covered files in the
package. What escaped, and what it says about the tests **[T for the line, J
for the reading]**:

- `rcon.go:81` `length < 10 || length > 4096`: both comparison mutants
  escaped. The bounds test (`rcon_test.go`) exercises a bad length but not
  the two edges, so `<=`/`>=` pass.
- `rcon.go:50-55`, `:78-79`, `:86-87`: every `if err != nil { return }` on the
  send and receive path can be deleted and the suite still passes. The
  auth-failure and dial-failure cases are tested; a failure *after* auth is
  not, which is the same gap the security review found by reading.
- `rcon.go` errorf-wrap, 5 of 5 escaped: no test uses `errors.Is`/`errors.As`
  through the `%w`, so unwrapping the cause is untested everywhere in this
  file.
- `rcon.go:14-16`, `:103-108`: the packet-type constants and the trailing
  null handling (`end > 8` at `:93`) survive being changed.
- `scheduler_validate.go:25-28`: the `Float`/`Integer`/`bool`/`Boolean` type
  aliases can be removed from the map; no test validates a graph that uses
  the alias spellings. Six `loop/break` mutants escaped, meaning early-exit
  from validation loops is never distinguished from continuing.

By mutator across both files, the weakest classes are `loop/break` 0 of 6,
`errorf-wrap` 0 of 5, `error-guard` 2 of 8. `statement/remove` at 12 of 13
and `logical` at 3 of 3 are strong, so the tests pin *what* the functions do
and mostly not *how they fail*.

### 4b. Coverage as a ranking input **[T]**

`go test ./... -coverprofile` per file, `backend/services` non-test, lowest
first: `opener.go`, `players.go`, `scheduler_preview.go` 0%; `worlds.go` 20.5%;
`scheduler.go` 29.0%; `scheduler_triggers.go` 29.1%; `installer.go` 31.2%;
`scheduler_attributes.go` 34.1%; `scheduler_registry.go` 39.9%;
`scheduler_blocks.go` 41.0%; `properties.go` 41.2%. Package total 60.1%
(checklist says 59.7% as of 2026-09-01; consistent). `app.go` is 2.0%, which
is fine for pass-throughs but means the four JSON-reading methods at
`app.go:479-575` have no test at all.

The brief's "high coverage, low mutation score" gap can only be ranked once
the full mutation run exists; the two-file sample is not enough to rank on.
The candidates to run first, because they are the security-relevant
high-coverage files: `config_editor.go` (57%, traversal guards), `backup.go`
(67%, zip-slip), `update.go` (78%, checksum), `modservice.go` (56%, SHA-512).

### 4c. Manual flags, frontend **[T for the site, J for the label]**

65 test files, about 608 cases, 1,224 `expect` calls. No test mocks the unit
it tests; every `vi.mock` targets `wailsjs/`. No snapshots. The roughly 180
`getByText(...).toBeTruthy()` calls are not weak, since `getByText` throws on
absence and so pins a string.

| File:line | Flag |
| --- | --- |
| `tiles/noBridge.test.tsx:59,66,82,96,97` | plain `not.toThrow()` around render. The file's own second half (`clickCollectingErrors`) is the real test; these five are render-smoke. |
| `stores/useCommandsStore.test.ts:62` | `SaveCommandButtons` `toHaveBeenCalled()` without the migrated payload, and the payload is the migration's point. |
| `stores/useLoaderStore.test.ts:147,203` | `.rejects.toBeDefined()`, no message or type. |
| `lib/clientErrors.test.ts:54`, `tiles/mods/ModAboutBody.test.tsx:60`, `tiles/scheduler/useScheduler.test.ts:115` | pure `not.toThrow()`. |
| `lib/theme.test.ts:285-286` | `toBeDefined()` on two tokens. |

Lowest `expect`-per-case files: `DisconnectConfirm.test.tsx` 1.0,
`lib/ipc.test.ts` 1.1, `lib/navWidth.test.ts` 1.3, `useProcessesStore.test.ts`
1.3, `lib/serverForm.test.ts` 1.3.

Genuinely strong, for balance: `useSchedulerStore.test.ts` (12 failure-mode
cases with exact error strings and optimistic revert), `useSettingsStore.test.ts`
(`'disk full'` reverts to the exact `crateOrder`), `useLayoutStore.test.ts`
(synchronous `TypeError` from a missing bridge), `LoaderUpdateDialog.test.tsx`
(every lifecycle phase with concrete copy), `noBridge.test.tsx`'s second half.

Go side, the one `staticcheck` hit in a test: `server_state_test.go:331`
assigns `events` and never reads it, which usually means an assertion was
meant to follow.

## 5. Security **[J unless marked]**

Threat model first, because it changes every severity: Konnekt is a local
desktop app with no listener. The Go side is reachable only from the WebView,
so "the frontend passes a bad value" needs a compromised WebView first. The
first row is the one path by which remote content reaches that WebView.

| Sev | Location | Issue | Why it matters |
| --- | --- | --- | --- |
| High | `frontend/src/tiles/mods/MarkdownBody.tsx:35` | Modrinth mod descriptions render through `rehype-raw` with no `rehype-sanitize`; `frontend/index.html` has no CSP **[T]**. | Third-party HTML runs same-origin in the WebView. React neutralises `<script>` and string `on*` handlers, but `<iframe srcdoc>`, `<object>`, `<meta refresh>` and `<style>` pass, and a same-origin srcdoc frame can call `parent.window.go.main.App.*`, which makes every row below reachable from a mod listing. |
| Medium | `app.go:463-475` `KickPlayer`/`BanPlayer`/`PardonPlayer` | `fmt.Sprintf("kick %s %s", name, reason)` then `Fprintln(stdin)` at `server.go:1048`, no CR/LF stripping **[T]**. | A `reason` containing `\n` is a second console command. Low impact for the operator who already owns the console; a real primitive after the row above. |
| Medium | `backup.go:46,55,149`, `config_editor.go:340`, `modservice.go:820`, `loader.go:331` | `serverID` is joined into data-dir paths with no single-segment check on the Go side **[T]**; IDs are minted in React and `config.go:53` accepts any `ID`. | `ListBackups("../../x")` reads and `DeleteBackup` removes any `*.zip` under an attacker-chosen directory. `RestoreBackup` is guarded by `validateFilename`. Untested. |
| Medium | `server.go:1186-1188,1215` | RCON `save-off`/`save-all flush`/`save-on` errors discarded; `PrepareForBackup` returns true regardless. | A dropped connection mid-command zips an unflushed world, and a failed `save-on` leaves autosave off until restart, silently. |
| Medium | `loader.go:385-450`, `installer.go:247` | NeoForge installer jar fetched over HTTPS, checked only for "is an installer of this version", then run with `java -jar`. Maven publishes `.sha256`/`.sha512` beside every artifact. | Integrity rests on TLS alone. |
| Low | `update.go:409-451` | Checksum and binary come from the same release; `DownloadURL` unpinned to a GitHub host; no signature; download client has no timeout. | Bounded to TLS-to-GitHub, which is the documented threat model in `SECURITY.md`. |
| Low | `rcon.go:49-73` | Response id never compared to request id; no cap on outgoing body; multi-packet responses truncated; `SetDeadline` unchecked. | Functional, not exploitable: the length prefix wraps the whole body, so framing is safe **[T, read]**. |
| Low | `backup.go:1008` G110 | `io.Copy` from a zip entry with no size cap. | A crafted backup can fill the disk on restore. Cap at the entry's declared size times a margin. |
| Info | `demo/backend/fixtures/config.js:122` `rcon.password=hunter2` | fixture, not a leak **[T]**. No real secrets, tokens or non-documentation IPs in the tree; `slog` never logs the RCON password, properties or the java command line **[T, grep of every `slog.` call]**. |

Already guarded, with the test that pins it: config-editor traversal and
symlink escape (`TestConfigEditorSandbox*`), backup filenames and zip-slip
(`TestValidateFilename`, `TestUnzipToRejectsZipSlip`), world names
(`validateWorldName`), mod filenames (`filepath.Base` at `modservice.go:242,953`)
and SHA-512 on download, every subprocess is `exec.Command` argv with no shell
(`server.go:265`, `installer.go:247`, `opener.go`), `java` via `LookPath`,
updater checksum with rollback (`TestDownloadAndApplyChecksumMismatch`), RCON
length bounds and wrong-password (`rcon_test.go:54-221`).

`gosec`'s 104 findings, read against that: the G304/G301/G302 rows are the
nature of an app whose job is to manage files in a directory the user chose;
the six G204 rows are all argv; the five G404 rows (`rcon.go:37,49`,
`scheduler.go:348`, `scheduler_blocks.go:694`, `backup.go:891`) are request ids
and jitter, not secrets. Worth a real look: G110 above, and the seven G115
integer conversions in `rcon.go`'s packet framing (`:64-90`), which are bounded
by the 4096 read cap but not by a comment saying so.

## 6. Health-doc drift

| Doc claim | Actual state |
| --- | --- |
| `DEPENDENCIES.md:100`: `@react-three/postprocessing` and `postprocessing` are part of the lazy-loaded worlds scene | Never imported in any commit of `frontend/src` **[T, `git log -S`]**. Two unused dependencies and a false rationale. |
| `DEPENDENCIES.md`: lucide "measured 2.6 KB gzip for the 20 in use" | 23 re-exported, 20 rendered; three dead re-exports. Number is stale, not wrong. |
| `HEALTH_CHECKLIST.md` Clean: "No obviously dead code" **[x]** | True on 2026-08-19, false since 2026-08-30 (§2). The item is a hand sweep with no gate, so its checkbox is a date, not a state. |
| `HEALTH_CHECKLIST.md` Clean: "No blank `_ =` error-ignores" **[x]**, verify grep `"_ = "` | The grep returns 0 and is satisfied; 40 `x, _ := f()` sites exist that it cannot match (§3b). The line is marked done against half the pattern. |
| `HEALTH_CHECKLIST.md` Stable: "three spellings" of `EventsOn` cleanup | Five (§3b). Same conclusion (all clean), wrong count. |
| `HEALTH_CHECKLIST.md` Stable: store write actions all comply, "all five stores" | `useLayoutStore.ts:57` `persistActiveLayout` records and does not rethrow; `useCommandsStore.ts:224` swallows. |
| `PerformanceSummary.tsx:39` doc comment | Points to a "connected form" nothing renders. |
| `README.md:16`: "Most of the code comes from Claude, with me reading over its shoulder" | Accurate, and it is the disclosure the brief was worried about. See §7. |

Documented commands and paths: every `pnpm` script named in `agent_docs/`
exists in `frontend/package.json`, every `scripts/` path referenced in the
docs and `suite.json` exists, `wailsjs` regeneration is checked by test **[T]**.
The one "missing" reference, `scripts/sync-tokens.sh`, is kollektiv's script
and is described as such. Coverage numbers in the checklist match within a
point. This part of the docs is in good shape, and the drift above is all in
the places the checklist's own verify recipes do not reach.

## 7. Verdict

The brief asks whether the codebase reads as "AI-assisted, human-directed"
or "fully generated". The README already says most of the code is
Claude's with a non-programmer directing it, so the question here is
narrower: does the *tree* show the direction, or only the generation?

It shows the direction, and unusually clearly **[J]**:

- The health log is 4,800 lines of a person deciding what the code should do
  and then checking that it does, including two occasions of mutation-checking
  tests by hand and finding a bad one. That document is the primary evidence
  of "human contribution" and no tool run in this audit contradicts it.
- The gates are real and they bite: three coverage and bundle ratchets, a
  generated-file diff check, an invariant grep, and a lint rule that was
  inverted from an allowlist to a global error on purpose. `deadcode` came
  back at zero across three modes, which a generated-and-forgotten tree does
  not do.
- Where the code is sloppy, the log usually already knows: the hover
  handlers, the `classifyLine` duplicate, the memoization question, the
  Overview double-fetch are all in the backlog before this audit named them.

What reads as generated, and would to a reviewer:

- **Symmetry written twice.** `ServerInfoPanel`/`WorldInfoPanel`, the two
  backup paths in `backup.go`, the two config walks, three dropdown menus,
  four `EventsOn` effects in `App.tsx`. Each pair is what a model produces
  when asked for "the same thing for worlds" in a fresh context, and none has
  been folded.
- **Component size.** Eighteen functions over 200 lines and a 780-line editor
  are not a style choice anyone made; they are the shape of output that was
  extended rather than restructured.
- **The 138 hover-style writes.** This one is the signature: a lint rule was
  added, and the next seventy hovers were written the one way the rule could
  not see, in the same shape each time.
- **Three orphans from one refactor eleven days after a dead-code sweep**,
  and two dependencies added with a scene that never used them.

So: defensible as AI-assisted and human-directed, and the health docs are
what make it defensible. The things that would undercut that claim are the
five bullets above, and four of them are one afternoon each. The one that is
not, the size of the big components, is the one a reader will notice first.

## 8. What to adopt, and what not to

Recommendations, ordered by what they buy **[J]**:

1. **`knip` with a `knip.json`** that ignores `wailsjs/**` and declares
   `playwright` as used by `demo/`. Add to `suite.json` `commands` and to
   CI's `frontend` job. It is the frontend half of the sweep the checklist
   already prescribes, and it would have caught §2 on the day.
2. **`staticcheck` and `deadcode` in `suite.json`**, both `GOOS`es, with the
   `job` false positive in a `staticcheck.conf` ignore. The checklist already
   names the commands; this makes the checkbox a state instead of a date.
3. **`gosec` with a config** that excludes G301/G302/G304/G306 (the app's
   job) and keeps G104, G110, G115, G204, G404. Run as a report, not a gate,
   until the G104 list is triaged into `//nolint` with reasons, which is the
   convention the tree already uses.
4. **`govulncheck` in CI** where the network allows it. Cheap and the one
   thing in the brief with no substitute.
5. **Widen the checklist's error-ignore grep** to `', _ :='` and decide per
   site: a `//nolint:errcheck // reason` or a handled error. Forty sites.
6. **ESLint `complexity` and `max-lines-per-function` as `warn`**, so the
   numbers appear in `pnpm lint` output without failing it, and ratchet the
   thresholds the way the coverage floors ratchet.
7. **Mutation testing periodically, not as a gate.** Run go-mutesting on the
   four security-relevant files first (§4b), record the scores in
   HEALTH_LOG, and repeat before a milestone. Stryker needs the two
   devDependencies; add them with a `DEPENDENCIES.md` line if it earns its
   keep on the first run.
8. **`jscpd` as a periodic report**, threshold `--min-lines 12` to cut the
   test-fixture noise. Not a gate: the scheduler-trigger clusters are fine as
   they are, and a gate would push someone to abstract them.

Not worth adopting: the brief's "fresh context" rule for the reasons in §0,
and its `gremlins` alternative (0.x, slower, and go-mutesting v2 already has
the baseline and CI-gate features it lists as reasons to prefer it).
`golangci-lint` is preinstalled in the cloud image and could replace items 2
and 3 with one binary and one config, at the cost of a dependency on its
release cadence; either is fine, but pick one rather than both.

## 9. The `scanaislop/aislop` tool, evaluated

Checked on the same day, at the user's request, by a separate agent that read
the source before running anything. Nothing under this repo was modified by
it; it ran `aislop scan` only, with telemetry and the update check disabled.

**What it is [T].** v0.16.0, a TypeScript CLI (npm, PyPI, Homebrew), MIT,
created 2026-03, about 600 stars, one primary author plus two regulars,
pushed the day of the run. Mostly an orchestrator: it vendors `oxlint`,
`biome` and `knip`, shells out to whatever it finds on the path (`gofmt`,
`golangci-lint`, `govulncheck`, `ruff`, `cppcheck`), adds about twenty regex
and AST heuristics of its own ("narrative comment", "swallowed exception",
"hidden fallback") and folds everything into a 0 to 100 score. The `scan`
path makes no model call; the separate `aislop agent` subcommand drives an
LLM and was not run.

**Can it be used in this session.** Yes, and it was. Safety, from source
**[T]**: telemetry to PostHog is **on by default**, opt-out via
`AISLOP_NO_TELEMETRY=1` or `DO_NOT_TRACK=1`, auto-off in CI; the payload is
allowlisted to version, OS, durations, counts and score buckets, with no
paths, code or repo name (`src/telemetry/redaction.ts`). An update check hits
the npm registry. No API key. No `shell: true` anywhere. `scan` writes only
to the OS temp dir. The `fix` subcommand is destructive (a regex line deleter
in its oxlint engine, and its knip engine rewrites `package.json`) and must
not be run here. `config/extends.ts` will fetch a remote config over HTTP if
one is configured, which this repo does not.

**Run output [T].** Score 76/100 "Healthy": 15 errors, 207 warnings, 362
files, 3.5 seconds. Errors: 13 `swallowed-exception`, all Go `x, _ :=` sites
(`loader.go:151,307,439`, `server.go:484`, `worlds.go:169,211`,
`modservice.go:264,569,965`, `serverlaunch.go:47`, `installer.go:203`,
`modjar.go:530`, `modidentify.go:211`), a strict subset of the 40 in §3b;
and 2 `security/innerhtml` at `website/changelog.js:85,103`. Top warnings:
99 narrative-comment, 31 duplicate-block, 28 function-too-long, 15
file-too-large, 12 meta-comment.

**Assessment [J].** The score is noise-dominated. 94 of the 99
narrative-comment hits are the repo's `// --- Section ---` separators, a house
style, all marked "fixable", meaning `fix` would strip them. Two of its most
confident findings re-litigate decisions this repo documented on purpose:
`lib/ipc.ts:54` "hidden fallback" is the sanctioned `hasWailsBridge()`
exception spelled out in `CLAUDE.md`, and every one of the 13 `_` ignores
carries a rationale comment above it. The two `innerHTML` errors are false
positives on inspection: `website/markdown.js:16,57` HTML-escapes the release
body before any formatting is applied and restricts link schemes, so the sink
is guarded. Its heuristics overlap the standard tools almost completely:
swallowed-exception is `errcheck`, duplicate-block is `jscpd`,
function-too-long is `gocyclo` plus ESLint `max-lines-per-function`, and
`knip` is vendored inside it.

**Recommendation [J].** A one-off curiosity, not a gate. Do not add it to
`.claude/suite.json`: a score that is 40% section-separator count would go
red on a style the repo chose, and default-on telemetry is the wrong default
for a shared gate. The one thing it surfaced that the §1 tool set did not is
that this repo runs no `errcheck`; that is item 5 in §8, and `errcheck` (or
`golangci-lint` with it enabled) covers it without the rest.
