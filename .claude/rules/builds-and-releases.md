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

`.github/workflows/snapshot.yml` publishes the other channel: a nightly build
of `main` (skipped when `main` hasn't moved), force-published to the rolling
`snapshot` tag as a **prerelease**, which is what keeps it out of
`/releases/latest` and therefore invisible to both the updater and the website's
primary download card. Its version keeps the `-dev` marker
(`0.1.0-dev.snapshot.<sha>`) so `app.go`'s install guard and the frontend's
`isDevBuild()` treat a snapshot as having no update path — snapshots are
refreshed by downloading a new one.

## Linux builds

The published Linux release (`konnekt-linux-amd64` + an `.rpm`) is built with
`-tags webkit2_41` against webkit2gtk-4.1 (see
`.github/workflows/release.yml`'s `build-linux`/`package-rpm` jobs and
`build/linux/`), which covers Rocky/RHEL 10, Fedora 36+, Ubuntu 22.04+, and
Debian 12+. Rocky/RHEL 9 is not supported — it never received webkit2gtk-4.1
and EL10 dropped 4.0, so the two aren't binary-compatible.

On a Rocky Linux 10 dev machine (or any distro on the 4.1 side), if WebKit
detection fails, build with:
```bash
wails build -tags webkit2_41
wails dev -tags webkit2_41
```
Run `wails doctor` first — it will tell you exactly which tag to use.
