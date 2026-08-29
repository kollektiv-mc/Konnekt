package main

// Version is Konnekt's build version. Overridden at build/release time via
// `-ldflags "-X main.Version=$TAG"` by .github/workflows/release.yml and
// .github/workflows/snapshot.yml. The "-dev" suffix marks a non-release build
// (e.g. `wails dev`) — the update checker treats it as "nothing to check
// against" since a dev build has no installable artifact.
//
// The base here is the version being worked towards, not the last one
// released: snapshots are stamped `<base>-snapshot.<stamp>.<sha>`, so the base
// has to keep them outranking the newest release or the snapshot channel goes
// quiet. Bump it whenever a tag catches up with it — see
// .claude/rules/builds-and-releases.md, and mirror it in wails.json.
var Version = "0.2.0-dev"
