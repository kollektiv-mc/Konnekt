---
paths:
  - ".github/workflows/**"
  - "version.go"
  - "wails.json"
  - "build/**"
  - "backend/services/update.go"
---

# Versioning & releases

`version.go`'s `Version` var is the single source of the app version,
mirrored in `wails.json`'s `info.productVersion`. `.github/workflows/release.yml`
builds and publishes on `v*` tags; the in-app updater
(`backend/services/update.go`) checks GitHub Releases. Only relevant when
cutting a release.

**After cutting a tag, bump `version.go`'s base and `wails.json`'s
`productVersion`.** This is not cosmetic. A snapshot is stamped as a prerelease
of that base, so once `v0.2.0` ships and the base is still `0.2.0`, every
snapshot sorts *below* the release: snapshot users are offered the stable build
once and then told they are up to date forever. The snapshot workflow emits a
`::warning::` when the base is not ahead of the newest release, which is the
only visible symptom.

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
  commit's own UTC date. `compareVersions` falls back to a string compare
  between two prerelease suffixes, so without that fixed-width timestamp two
  snapshots sort by sha, which says nothing about which is newer. It is
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
