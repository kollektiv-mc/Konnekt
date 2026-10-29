# Konnekt: Security Checklist

The target for `/security-check` (`.claude/skills/security-check/SKILL.md`),
which holds the procedure. This file states how each security-relevant part of
the app must be, how to verify it, and what an auditor should try to break.

**How to use this doc:** compare the tree against every item. Do not edit an
item to match what the code does; it is the target, not a snapshot. An item that
turns out wrong or untestable is corrected here with the reason. Only
`Open backlog` should churn.

**Who the attacker is.** `SECURITY.md` defines it: anyone other than the person
running Konnekt. Two reaches matter:

- **Network:** input that arrives from a third party. GitHub release metadata
  and assets, the Modrinth API and CDN, the NeoForge Maven, server log lines
  written by players, and whatever a scheduler HTTP block talks to.
- **Bridge:** a bound method on `App`. Today only the local WebView can call
  one, so a bridge-only gap is hardening, not a vulnerability. Two things
  promote it: script running in the WebView (see S5), and Remote Access, which
  hands the bridge to whoever holds a session (see S8). Every bridge item is
  written so it already holds when that happens.

Bound methods on 2026-10-17: **115** (105 on 2026-10-01; each one since is
classified in `remote_methods.go`, which `remote_methods_test.go` holds)
(`grep -c '^func (a \*App) [A-Z]' app.go`). A different count is new surface;
step 3 of the skill classifies it.

---

## Scanners

Run from the repo root. `go` scanners load the root package, which embeds
`frontend/dist`, so build it first (`pnpm install && pnpm build` in `frontend/`);
without it the root package is skipped and the run says so.

```sh
go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 ./...
go run github.com/securego/gosec/v2/cmd/gosec@v2.29.0 -quiet -exclude=G104 -exclude-dir=scripts ./...
pnpm audit --prod        # from frontend/
```

- **govulncheck** reports only vulnerabilities whose symbols are reachable. Any
  finding is a fail until the module is upgraded.
- **gosec** excludes G104 because the `no discarded errors` invariant in
  `.claude/suite.json` already holds that rule with better precision, and
  `scripts/` because it is build tooling that takes no outside input. The rest is
  not a gate: judge every finding in a file this checklist names, and every
  HIGH, against the item it touches. G304/G301/G302/G306 are expected on the
  guarded paths in S3; the question is whether the guard runs first. G404
  (`math/rand`) is correct for RCON request ids and graph ids, and is a fail
  anywhere a value is a secret or a token.
- **pnpm audit** covers the shipped frontend dependencies only (`--prod`).
  Dev-dependency advisories do not reach users.

CodeQL (`.github/workflows/codeql.yml`) and Scorecard
(`.github/workflows/scorecard.yml`) run in CI. Read their latest results in the
repository's Security tab rather than re-running them.

---

## S1. Updates and downloads

Network reach. Everything Konnekt downloads either replaces its own binary or
becomes code the server runs.

**S1.1 The updater verifies before it replaces.**
Holds when: `DownloadAndInstallUpdate` re-resolves the release itself instead of
trusting a frontend argument, picks the asset by exact name, verifies SHA-256
against the release's `checksums.txt`, and replaces atomically with rollback
(`selfupdate.Apply`). Package-managed installs are refused.
Verify: `go test ./backend/services -run 'TestDownloadAndApply|TestParseChecksums|TestSelectPlatformAssets|TestDownloadAndInstallUpdateRefusesAPackageInstall'`.
Probe: can the frontend influence which URL is fetched? Does a failed write
leave a partial binary in place?

**S1.2 Update authenticity does not rest on the same origin as the binary.**
Holds when: the updater verifies something an attacker who can publish a release
asset cannot forge, such as the build provenance `release.yml` already publishes
with `actions/attest`, or a signature over `checksums.txt` made with a key that
is not in the repository.
Verify: read `backend/services/update.go` from `CheckForUpdates` to `Apply`.
Probe: with write access to one release's assets, what stops a matching binary
and checksum pair?

**S1.3 Download URLs are pinned to scheme and host.**
Holds when: every URL taken from an API response is checked for `https` and an
expected host before it is fetched: GitHub release assets, Modrinth `FileURL`,
NeoForge Maven.
Verify: `grep -rn 'DownloadURL\|FileURL\|BrowserDownloadURL\|maven.neoforged' --include=*.go backend | grep -v _test`
and read each fetch.
Probe: return `http://` or another host from a stubbed API (the tests use
`httptest.Server`; reuse that shape).

**S1.4 Every outbound request has a timeout and a size bound.**
Holds when: no `&http.Client{}` without `Timeout` is used for a download, and no
response body is read with an unbounded `io.ReadAll`.
Verify: `grep -rn 'http.Client{\|io.ReadAll(' --include=*.go backend | grep -v _test`.
Probe: a server that never finishes the body, or sends 10 GB.

**S1.5 Mod jars are verified against Modrinth's SHA-512, and a missing hash
refuses.**
Holds when: `downloadVerified` (`backend/services/modservice.go`) refuses a
version whose `hashes.sha512` is empty instead of skipping the check, and a test
covers both a mismatch and a missing hash.
Verify: read `downloadVerified`; `grep -n 'sha512\|SHA512' backend/services/modservice_test.go`.

**S1.6 Loader installers are verified against a published hash.**
Holds when: the NeoForge installer download is checked against the Maven
`.sha256`/`.sha1` sidecar (or an equivalent) before `InspectInstaller`, and
`req.Version` is checked against the fetched version list before it becomes
part of a URL.
Verify: read `backend/services/neoforge.go` and `loader.go` around the download.

---

## S2. Credentials

**S2.1 The RCON password never leaves memory except to the RCON socket.**
Holds when: `rconPassword` and `rcon.password` appear in no `slog` call, no
`Emit` payload, no error string, and no file Konnekt writes on its own account.
`ReadConfigFile` returning `server.properties` to the config editor is by design
and is the one exception.
Verify: `grep -rn 'rconPassword\|rcon.password\|RconConfig' --include=*.go . | grep -v _test`,
then follow each hit to where the value goes.
Probe: every error path in `rcon.go` after authentication; a panic inside a
scheduler RCON block.

**S2.2 Files that hold a credential are owner-only.**
Holds when: a rewrite of `server.properties` is never wider than the mode it
already had (`writeFileAtomic` applies the requested mode AND the existing one),
every copy Konnekt makes of it (the config editor's `.bak` files under
`<dataDir>/config_backups/<id>/`, a `0700` directory) is created `0600`, and `remote.json` (the Remote
Access password hash and device token hashes, added with #45) is written
through `WritePrivateDataFile`, which is `0600`. So is each bucket destination's
secret access key (#480): one file per destination under
`<dataDir>/destination_secrets/` (a `0700` directory), named by the destination's
id, which `DestinationService` validates before it names a path. `destinations.json`
beside it holds no secret.
Verify: `grep -rn 'writeFileAtomic(\|OpenFile(\|WriteFile(' --include=*.go backend | grep -v _test`
and check the mode at each call that can touch `server.properties`.

**S2.3 App data holds no secrets.**
Holds when: `models.AppSettings` and `models.ServerConfig` carry no password,
token or key. A future credential (S8) is stored hashed, never in these. A
bucket destination follows the same rule: `models.Destination` has no secret
field, only `SecretSet`, and `SaveDestination` takes the secret as a separate
argument.
Verify: read `backend/models/`.

---

## S3. Paths

Bridge reach. A name that crosses the bridge and becomes a file operation is the
main thing Remote Access will expose.

**S3.1 Every bridge-supplied name passes a named guard before it touches the
filesystem.**

| Input | Guard | Where |
|---|---|---|
| server id | `validServerID` | `config.go` |
| backup file name | `validateFilename` | `backup.go` |
| world name | `validateWorldName` | `worlds.go` |
| config editor `relPath` | `ConfigEditorService.sandbox` | `config_editor.go` |
| mod file name | `filepath.Base` then `sandboxCheck` | `modservice.go` |
| upload block source | `resolveUploadSource`, then `collectUploadItems` for links | `upload.go` |
| snapshot staging folder | `dhStagingRoot` (`validServerID`), or `dhStageDir` for an absolute path outside the server folder | `scheduler_blocks_dhsnapshot.go` |

Holds when: each method in the table's files that takes a name applies its guard
before the first filesystem call, and a mod file name is reduced to its base
name (a jar name never contains a separator) before `findJarFolder`.
Verify: `grep -rn 'validServerID\|validateFilename\|validateWorldName\|sandboxCheck\|\.sandbox(\|filepath.Base' backend/services/*.go | grep -v _test`,
then read each bound method in step order.
Probe: `../server.properties`, `..\\x`, an absolute path, `C:x`, a NUL byte, an
empty string, and a symlink planted inside the working directory, against every
method in the table.

**S3.2 Every guard has a traversal test.**
Holds when: each guard in S3.1 has a test feeding it `../` input, and each bound
method that uses it has one proving the refusal reaches the caller.
Verify: `grep -rn '^func Test' --include=*_test.go backend | grep -iE 'travers|escape|slip|symlink|sandbox|valid.*(name|id)|refuse|reject'`
and match the result against the table.

**S3.3 The config editor edits only what it lists.**
Holds when: `ReadConfigFile` and `WriteConfigFile` accept only paths that
`ListConfigFiles` returns, so launch scripts, `user_jvm_args.txt` and jars are
not writable through it.
Verify: read `config_editor.go` from `WriteConfigFile` to `sandbox`.

**S3.4 Archives cannot escape or smuggle.**
Holds when: restore extracts each entry under the target (zip-slip) with the
declared total capped; restore never creates a symlink; backup creation does not
follow a symlink out of the world directory.
Verify: `go test ./backend/services -run 'TestUnzipTo|TestZipDeclaredTotal|TestRestoreBackupRejectsTraversingFilename'`;
read `writeTreeToZip` for `ModeSymlink`.
Probe: a world directory containing a symlink to `~/.ssh`, then a backup.

---

## S4. Processes and command input

**S4.1 No shell.**
Holds when: every `exec.Command` passes arguments as a slice, and none is
`sh -c`, `bash -c`, `cmd /c` or `powershell`. `run.sh`/`run.bat` are tokenised by
`parseLaunchScript`, never executed through a shell.
Verify: `grep -rn 'exec.Command' --include=*.go . | grep -v _test`.

**S4.2 Console and RCON input cannot smuggle a second command.**
Holds when: `SendCommand` and every scheduler block that sends a console or RCON
command refuse `\r` and `\n`.
Verify: `go test ./backend/services -run TestSendCommandRefusesALineBreak`;
read the command and RCON blocks in `scheduler_blocks.go`.

**S4.3 A properties write cannot add a property.**
Holds when: `writeProperty` (`properties.go`) refuses a value containing `\r` or
`\n`, and a test covers it.
Verify: `grep -n 'writeProperty' backend/services/*_test.go`.

**S4.4 Player-written log lines cannot impersonate server events.**
Holds when: the join, leave and chat matchers accept only lines the server
itself writes.
Verify: `go test ./backend/services -run 'TestPlayerMatchersRejectSpoofedLines|TestStreamOutputEmitsConsoleLinesWithoutEscapes'`.
Probe: a chat message containing `joined the game`.

**S4.5 Launch configuration is code, and is treated as such.**
`ServerConfig.JvmArgs`, the jar path and `InstallServer`'s jar are run as given.
That is by design locally. Holds when: S8.2 keeps every method that writes them
off the remote surface.

---

## S5. WebView and remote content

The WebView is same-origin with `window.go`, so script in it is every bound
method.

**S5.1 A Content-Security-Policy ships in every build.**
Holds when: `frontend/index.html` carries a policy with `script-src 'self'`,
`object-src 'none'`, `frame-src 'none'` and `base-uri 'self'`, stripped only by
`vite serve`.
Verify: `grep -n 'Content-Security-Policy' -A1 frontend/index.html`;
`grep -n "apply: 'serve'" frontend/vite.config.ts`.

**S5.2 No raw HTML sinks.**
Verify: `grep -rn 'dangerouslySetInnerHTML\|innerHTML\|outerHTML\|insertAdjacentHTML\|eval(\|new Function(' frontend/src | grep -v '\.test\.tsx\?:'`
must find nothing. Tests are excluded because resetting `document.body` between
cases is not a sink.

**S5.3 Third-party HTML is sanitised before it renders.**
Holds when: a Modrinth body goes through `rehype-sanitize` after `rehype-raw`
(`tiles/mods/MarkdownBody.tsx`), and any new sink for remote HTML reuses that
component rather than a second schema.
Verify: `pnpm vitest run src/tiles/mods/MarkdownBody` from `frontend/`.

**S5.4 Only http(s) URLs reach the system browser.**
Holds when: every `BrowserOpenURL` argument is a constant or has passed an
`^https?://` check. That includes URLs from the GitHub API, such as a release
page.
Verify: `grep -rn 'BrowserOpenURL(' frontend/src | grep -v test` and trace each
argument to its source.
Probe: a `file:`, `javascript:` or custom-scheme URL in a stubbed API response.

**S5.5 Release builds have no inspector.**
Verify: `grep -n 'wails build' .github/workflows/*.yml` shows no `-devtools` or
`-debug`.

---

## S6. Scheduler

A graph runs unattended with the app's privileges.

**S6.1 An imported graph is validated like a saved one.**
Holds when: `ImportScheduleGraphJSON` bounds the input size and runs the same
type validation the engine runs, before anything is saved.
Verify: read `ImportGraphJSON` in `backend/services/scheduler.go`.

**S6.2 A save or import cannot touch another server's graph.**
Holds when: `SaveGraph` refuses an id that belongs to a different server, as the
other mutators already do, and `TestMutatorsRefuseAnotherServersGraph` covers
save and import.
Verify: `go test ./backend/services -run TestMutatorsRefuseAnotherServersGraph -v`
and read which mutators it exercises.

**S6.3 The HTTP block is bounded.**
Holds when: it accepts `http`/`https` only, has a timeout, and reads a bounded
response. Whether loopback and private addresses are allowed is a written
decision in `scheduler_blocks.go`, not an accident.
Verify: read `execHTTP` in `backend/services/scheduler_blocks.go`.

---

## S7. CI and supply chain

**S7.1 Every workflow declares top-level `permissions:`, at the least it needs.**
Verify: `grep -L '^permissions:' .github/workflows/*.yml` must find nothing.

**S7.2 Actions are pinned by commit SHA.**
Verify: `grep -hnE '^\s*(- )?uses: ' .github/workflows/*.yml | grep -v '@[0-9a-f]\{40\} # v'`
must find nothing, apart from local actions (`./`). Anchored because a comment
can contain the substring. The trailing `# vX.Y.Z` is what Dependabot reads to
keep the pin current; kollektiv's `docs/conventions.md` has the rule.
The workflows vendored from kollektiv (`aislop.yml`, `codeql.yml`,
`pr-labelled.yml`, `scorecard.yml`, `issue-priority.yml`) are pinned in
kollektiv's masters and re-synced, never edited here.

**S7.3 Dependabot covers every ecosystem that ships.**
Verify: `.github/dependabot.yml` lists `gomod`, `npm` for `/frontend`, and
`github-actions`.

**S7.4 A vulnerability scanner runs in CI.**
Holds when: govulncheck runs in CI once per shipped GOOS, pinned at the same
version as `Scanners`.
Verify: `grep -rn 'govulncheck@' .github/workflows` shows the `backend` and
`backend-linux` jobs at the version above.

---

## S8. Remote access

Applies when: `backend/services/remote*.go` exists (issues #43 to #47). Until
then every item is `n/a`, but read them before any Remote Access work starts:
they are the acceptance criteria.

The files exist since #43 (the listener, the allowlist dispatcher and the
event mirror) and #45 (`remote_auth.go`: the password, the devices and the
sessions), so the items apply. The listener can be switched on from Settings >
Remote Access (#47) and published through a tunnel (#46, `tunnel.go`), so
every item is live and a `fail` on any of them is a finding.

**S8.1 The remote surface is an allowlist, held by a test.**
Holds when: remote dispatch reaches only methods listed with a tier (`read`,
`operate`, `admin`) and a reason, and a test in the shape of
`scoping_test.go`'s `TestBoundMethodsThatActOnAServerTakeItsID` parses `app.go`
and fails on any bound method that is not classified. There is no reflection
over the whole `App`.
Verify: find the test; add an unclassified method in a scratch branch and watch
it fail.

**S8.2 Nothing that amounts to code execution on the host is remote-callable
without desktop approval.**
At minimum: `SaveServerConfig`, `InstallServer`, `UpdateLoader`,
`WriteConfigFile`, `SaveAppSettings`, `DownloadAndInstallUpdate`,
`ImportScheduleGraphJSON`, `SaveScheduleGraph`, and the native-host methods
(`BrowseJarFile`, `BrowseDirectory`, `OpenDataDir`, `OpenBackupDir`,
`OpenWorldFolder`).
Verify: read the S8.1 allowlist.

**S8.3 The listener trusts nothing about where a request came from.**
Holds when: it binds `127.0.0.1` only; every request, including the `/ws`
upgrade, is refused unless `Host` and `Origin` match an allowlist (DNS
rebinding, cross-site WebSocket hijacking); no decision depends on the source
address being loopback, since every tunnelled request is.
Verify: `httptest` tests for a foreign `Origin` on `/ws` and a foreign `Host`
on `/api/rpc`, each refused.

**S8.4 Login resists guessing.**
Holds when: the password is stored as an argon2id hash, compared in constant
time, and login is rate-limited with backoff keyed on something other than the
source address.
Verify: tests for the hash format, and for the Nth failed attempt being refused.

**S8.5 Sessions are unguessable, scoped and revocable.**
Holds when: tokens come from `crypto/rand` with at least 128 bits, travel in an
`HttpOnly; Secure; SameSite=Strict` cookie, expire, and can all be revoked from
the desktop. No token in `localStorage` (banned by `agent_docs/CLAUDE.md`
anyway) or in a URL.
Verify: `grep -rn 'math/rand' backend/services/remote*.go` finds nothing; tests
for expiry and revocation.

**S8.6 A new device is approved on the desktop before its first session.**
Verify: a test where an unapproved device's valid password yields no session.

**S8.7 Security headers are HTTP headers.**
Holds when: responses carry the CSP as a header with `frame-ancestors 'none'`
added (a `<meta>` policy cannot set `frame-ancestors`), plus
`X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. The one
exception is the OAuth consent page (§ S9), which sends
`Referrer-Policy: same-origin`: under `no-referrer` a browser posts its form
with `Origin: null`, which the Origin check refuses.
Verify: an `httptest` test asserting each header on `/`, and the consent tests
asserting `same-origin` on the page.

**S8.8 Remote access is off unless switched on, and visibly on.**
Holds when: it defaults to off, stops after an idle period (the one exception
is § S9.10's, and it is visible), and the desktop shows its state and the
connected devices.

**S8.9 Every remote action is logged, and no log line holds a credential.**
Verify: a test that a remote call writes one log line naming the method and the
device, and S2.1's grep extended to the remote files.

**S8.10 The tunnel binary is verified like S1.**
Holds when: `cloudflared` is fetched at a pinned version and checked against a
pinned hash before it is executed.

**S8.11 A remote client cannot change what the desktop is looking at.**
Holds when: the active server is per client, not the global
`SetActiveServerID`, or `SetActiveServerID` is not remote-callable.

---

## S9. Claude through MCP

Applies when: an `mcp*.go` file exists (#507, issues #509 to #515). Until
then every item is `n/a`, but they are the acceptance criteria and are read
before any MCP work starts. MCP is a second client of the Remote Access
machinery, so every § S8 item applies to it unchanged; these items are what MCP
adds. The threat model beyond § S8 is in #507: prompt injection through tool
results, theft of a token held outside Konnekt, local processes reaching a
loopback port, and OAuth misuse.

**S9.1 Every tool maps to one allowlisted method of tier `read` or `operate`.**
Holds when: each catalog entry names exactly one `remote_methods.go` entry, that
entry's tier is `read` or `operate`, and no tool reaches an `admin` or
`neverRemote` method. A test that parses the catalog holds this, in the shape of
`remote_methods_test.go`. There is no reflection over `App`.
Verify: find the test; add a catalog entry over an `admin` method in a scratch
branch and watch it fail.
Probe: can a tool reach a method the browser remote cannot?

**S9.2 No third-party text reaches the static surface.**
Holds when: tool names, tool descriptions and the server `instructions` are
compile-time constants, with no server, world or player name in them. Untrusted
text in a result (console lines, player names, ban reasons, MOTDs, mod
descriptions) travels in `structuredContent` fields the text part names as
third-party text, stripped of control characters and ANSI escapes and capped
in length.
Verify: a test where a console line carrying a fake instruction arrives only
inside a marked field.
Probe: can a player's chat line change what Claude is told a tool does?

**S9.3 The raw console command waits for desktop approval on every call.**
Holds when: the console tool goes through `RemoteApprovals.Ask` with the exact
command and the calling client shown, with no "remember"; no answer is a
refusal. Kick, ban and pardon validate the name as a player name and refuse a
target selector, for every caller and not only MCP.
Verify: tests for an unanswered console call refused, and for `@a`, `@e[...]`,
a space and an empty name refused.
Probe: with nobody at the desktop, what can an injected instruction run?

**S9.4 The local bridge is loopback-only and keyed by an owner-only secret.**
Holds when: the bridge's endpoint binds `127.0.0.1`, checks a `crypto/rand`
secret kept in a `0600` file written by `WritePrivateDataFile` and regenerated
at every start, passes the Host and Origin guard, and is not reachable on the
tunnel's hostname. On Windows the protection is the per-user profile directory
rather than an ACL, and the Settings text says exactly that.
Verify: tests driving the bridge with the right secret, the wrong one and none,
and a request carrying an `Origin` refused.
Probe: a page in the user's browser posting to the bridge's port.

**S9.5 The HTTP endpoint accepts only tokens it issued for itself.**
Holds when: an unauthenticated request gets `401` with
`WWW-Authenticate: Bearer resource_metadata="..."`; a request whose `Origin` is
present and not allowed gets `403`; a token issued for another resource, a
token in the query string and the dashboard's cookie are each refused; and
`/api/rpc` ignores bearer tokens. Nothing is authorized by an MCP session.
Verify: `httptest` tests for each refusal.
Probe: replay a `konnekt_session` cookie against `/mcp`; replay an MCP token
against `/api/rpc`.

**S9.6 OAuth follows OAuth 2.1 as the MCP authorization spec profiles it.**
Holds when: PKCE S256 is required and advertised; redirect URIs match exactly
(`https://claude.ai/api/mcp/auth_callback`, and `http://localhost/callback` and
`http://127.0.0.1/callback` with the port ignored, for Claude Code); codes are
single-use and short-lived; the consent page carries a CSRF token,
`frame-ancestors 'none'` and the redirect URI's hostname; tokens come from
`crypto/rand` with at least 128 bits and are stored as SHA-256; an access token
lasts one hour; a refresh token rotates on every use and a replayed one revokes
the grant; a grant ends after thirty days unused or ninety days in all; every
grant can be revoked from the desktop; and a password change revokes them all.
Verify: tests for each clause; `grep -rn 'math/rand' backend/services/mcp*.go`
finds nothing.
Probe: replay a rotated refresh token; present a code twice; a redirect URI
that differs by a trailing slash.

**S9.7 Fetching a Client ID Metadata Document is pinned.**
Holds when: the URL is `https` only; the resolved address is public (no
loopback, private or link-local), checked after resolution and on every
redirect, or redirects are not followed; the fetch has a timeout and a size
bound (§ S1.3, § S1.4); and Dynamic Client Registration entries are capped in
number and expire unused.
Verify: tests with a `client_id` resolving to `127.0.0.1`, `10.0.0.1` and
`169.254.169.254`, each refused.
Probe: an authorization request whose `client_id` points at the listener's own
loopback port.

**S9.8 The named-tunnel token is a credential and treated as one.**
Holds when: it lives in an owner-only file written by `WritePrivateDataFile`,
reaches `cloudflared` only through `--token-file`, and appears in no argv, no
`AppSettings` field and no log line.
Verify: the stand-in-process tests in `tunnel_test.go` show the token passed by
file only; S2.1's grep extended to `tunnel*.go`.
Probe: the process list while the tunnel runs.

**S9.9 Every MCP call writes one log line and no argument.**
Holds when: the line names the tool, the client and the server id, and never an
argument (§ S8.9).
Verify: a test asserting the line's fields on a call with a distinctive
argument.

**S9.10 Staying up is a choice the desktop made and can see.**
Holds when: the listener outlives § S8.8's idle period only while a named
tunnel is configured and "Allow Claude connectors" is on, both off by default;
the title bar shows the listener the whole time; and turning either off
restores the idle stop.
Verify: a test that the idle stop fires with the quick tunnel, and does not
with a named tunnel and the switch on.
Probe: what keeps the sign-in page reachable overnight, and who can tell?

---

## Open backlog

Hardening gaps with no reachable impact on a user, found by a run and not yet
fixed, each with its issue.

**Never list an exploitable finding here.** This repository is public. Anything
someone other than the user can trigger goes to a private advisory
(`SECURITY.md`) and appears here only after the fix has shipped.

_Empty._ Nothing has been recorded yet; the first `/security-check` run fills
this.
