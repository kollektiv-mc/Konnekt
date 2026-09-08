---
paths:
  - ".github/workflows/**"
  - ".github/scripts/**"
  - "version.go"
  - "wails.json"
  - "build/**"
  - "backend/services/update.go"
---

# Versioning & releases

`version.go`'s `Version` var is the single source of the app version,
mirrored in `wails.json`'s `info.productVersion`. `.github/workflows/release.yml`
builds and publishes a release, cut from the Actions tab or from a pushed `v*`
tag; the in-app updater (`backend/services/update.go`) checks GitHub Releases.
Only relevant when cutting a release.

## Cutting a release

Actions tab, **Release**, **Run workflow**, on `main`. Two inputs: the channel
(`alpha`, `beta`, `stable`) and the `X.Y.Z` the build belongs to. The `resolve`
job turns those into the tag and creates it: the next free counter for a
prerelease (`v0.2.0-alpha.3` after `v0.2.0-alpha.2`, counted per channel and
per core) or the bare `v0.2.0` for stable. `.github/scripts/release-tag.py` is
the decision, `release-tag_test.py` pins it, and CI runs the test.

The ladder each version climbs is `alpha.N`, then `beta.N`, then the bare
version. Nothing forces a version through every rung, but an alpha cannot
follow a beta of the same core and no tag can follow one it sorts at or below:
`compareVersions` would never offer it to anyone on the higher tag, so the
resolver refuses it. It also refuses any tag off the
`vX.Y.Z[-alpha.N|-beta.N]` shape. `rc`, `-dev`, a missing counter and the
pre-semver `v2.0-alpha` shape all fail the same way.

**Before a final, bump the base.** A snapshot of `version.go`'s base has to
outrank the tag being cut, or the snapshot channel goes quiet (next section).
For an alpha or beta that holds whenever the base core is at least the tag's,
so `0.2.0-dev` cuts `v0.2.0-alpha.N` and `v0.2.0-beta.N` with no bump. For
`v0.2.0` itself the base must already be past it, `0.2.1-dev` or `0.3.0-dev`,
and the resolver refuses the tag until it is. The bump is a commit on `main`
that goes through CI, and the workflow will not make one, so it is asked for
up front, when it costs a merge rather than a stranded channel. The same
applies when a prerelease jumps the core ahead: `v0.3.0-alpha.1` needs
`0.3.0-dev` in place first.

**The prerelease flag is decided by the resolver, not the tag.** An alpha or
beta is flagged only once a final has shipped. A flagged release leaves
`/releases/latest`, which the stable channel, the website's download card and
the notes baseline all read, so while every release is an alpha, flagging one
would freeze all three on the previous alpha. The "Pre-release" line in the
body is a separate thing, decided by the tag's suffix, and always present on
one.

A hand-pushed tag (`git tag v0.2.0-alpha.1 && git push origin v0.2.0-alpha.1`)
still works and goes through the same `resolve` job, minus the tag creation,
so it is held to the same rules: a tag that would strand the channel fails the
run rather than shipping. It is the path for releasing something other than
`main`, which the dispatch refuses. The tag the dispatch creates is pushed with
`GITHUB_TOKEN`, which GitHub does not fan out into another run, so the build
continues in the run that made it; that is why every job after `resolve`
checks out and stamps `needs.resolve.outputs.tag` rather than
`github.ref_name`, which on a dispatch is the branch.

**`version.go`'s base is the version being worked towards, not the last one
released, and `wails.json`'s `productVersion` mirrors it.** This is not
cosmetic. A snapshot is stamped `<base>-snapshot.<stamp>.<sha>`, so the base
has to be a version its snapshots can still outrank. `0.2.0-snapshot.*` beats
`v0.2.0-alpha.1` and loses to `v0.2.0`, which is right in both directions: a
base level with the core of a *prerelease* tag is fine, and the bump is due
when a final release of that core ships or when a tag jumps the core ahead.
Get it wrong and snapshot users are offered the stable build once and then told
they are up to date forever.

`.github/scripts/version-precedence.py` is what notices, applying
`update.go`'s own `compareVersions` rules to the snapshot about to be built.
The snapshot workflow runs it nightly and it emits a `::warning::`; the release
workflow's `resolve` job applies the same comparison to the tag about to be cut
and refuses it outright, which is what keeps the warning from ever firing for a
tag cut through it. Do not reimplement that comparison in shell: the
version of this guard that was, used `sort -V`, which has no notion of
prerelease precedence, and covered for that by only examining *final*
releases, so every prerelease tag skipped the check. `version-precedence_test.py`
runs the Go function's own test table through the Python in CI, which is what
keeps the two answering the same.

## Release notes

`.github/scripts/release-notes.py` writes the body for both channels, and
`agent_docs/CLAUDE.md` covers what reaches it. Its output starts at
`## What's changed` and is nothing but the changes, because that section is all
the website's changelog shows (`website/release.js`'s `changesOnly`).

Each workflow prepends its own preamble: `snapshot.yml` says what a snapshot is
and that it can be broken, `release.yml` says which assets are attached, that
they carry no code-signing certificate, and how to verify one, plus a
pre-release line when the tag carries a suffix. Both channels attest their
artifacts (`actions/attest` in each publish job), so the verification the
preamble points at is `gh attestation verify`, with `checksums.txt` as the
fallback for anyone without the `gh` CLI. Anything a reader needs on the
GitHub page but not on the changelog page belongs there.

## The snapshot channel

`.github/workflows/snapshot.yml` publishes the other channel: a nightly build
of `main` (skipped when `main` hasn't moved), force-published to the rolling
`snapshot` tag as a **prerelease**. The prerelease flag keeps it out of
`/releases/latest`, and so out of the website's primary download card and its
changelog list.

The updater does reach it, but only deliberately. It asks for
`/releases/tags/snapshot` by name, and only on the snapshot channel: a stable
install never sends that request at all. The channel is
`models.AppSettings.UpdateChannel` (`"stable"` by default, set under Settings >
General), except that a build which *is* a snapshot always follows the snapshot
channel regardless — see `services.EffectiveChannel`. On that channel the
updater takes whichever of the two releases has the higher version, ties going
to stable, so a snapshot user is carried back to stable once a release
overtakes their build.

Two things about the format are load-bearing:

- **The version is `<base>-snapshot.<YYYYMMDDHHMM>.<sha7>`**, stamped from the
  commit's own UTC date. `compareVersions` orders prerelease suffixes identifier
  by identifier, numbers as numbers and words as text, so without that
  timestamp two snapshots sort by sha, which says nothing about which is newer.
  It is
  deliberately **not** `-dev`: that marker now means one thing only, a local
  `wails dev` build, and both `services.IsInstallableBuild` and the frontend's
  `isDevBuild()` must classify a snapshot as installable.
- **The release title is the bare version string**, and the updater parses it as
  one (`releaseVersion`). The tag cannot carry it, since `snapshot` is a rolling
  literal. Do not decorate the title: a title with a space in it is rejected as
  unparseable and the channel silently goes quiet. The publish step greps the
  computed version against the expected shape before creating the release,
  which is the only guard on this.

Snapshots published before 2026-08 used `0.1.0-dev.snapshot.<sha>` and a
`Snapshot <version>` title. Those builds run the old binary and cannot
self-update; the title format is rejected rather than misparsed, so a client on
the new code falls back to stable during the window between merging and the next
nightly.

## Linux builds

The Linux artifacts (`konnekt-linux-amd64` + an `.rpm`) are built with
`-tags webkit2_41` against webkit2gtk-4.1 (see
`.github/workflows/release.yml`'s `build-linux`/`package-rpm` jobs and
`build/linux/`), which covers Rocky/RHEL 10, Fedora 36+, Ubuntu 22.04+, and
Debian 12+. Rocky/RHEL 9 is not supported — it never received webkit2gtk-4.1
and EL10 dropped 4.0, so the two aren't binary-compatible.

They have only ever shipped on the `snapshot` prerelease. The `build-linux` and
`package-rpm` jobs were added after the one tagged release, `v0.1.0-alpha.1`,
was cut, so that release carries the Windows exe and nothing else. Nothing in
`release.yml` is conditional, so the next `v*` tag attaches all three.

On a Rocky Linux 10 dev machine (or any distro on the 4.1 side), if WebKit
detection fails, build with:
```bash
wails build -tags webkit2_41
wails dev -tags webkit2_41
```
Run `wails doctor` first — it will tell you exactly which tag to use.
