# Build Directory

Build files and assets for the packaged application.

* `bin` - Output directory
* `darwin` - macOS specific files
* `linux` - `.desktop` entry and RPM spec (see `.claude/rules/builds-and-releases.md`)
* `windows` - Windows specific files

## Icons

`appicon.png` is the source of every icon the app ships, and is the same file
as the website's `website/assets/img/app-icon.png`. Nothing else here is drawn
by hand:

| File | Consumer | How it is produced |
|---|---|---|
| `appicon.png` | the source, and macOS | Wails encodes it into `iconfile.icns` inside the `.app` bundle on every `wails build` |
| `windows/icon.ico` | the exe's icon resource, and the NSIS installer (`MUI_ICON`) | `go run ./scripts/gen-icons`, committed |
| `appicon-256.png` | the GTK window icon (embedded by `main.go`) and the RPM's `/usr/share/pixmaps` entry | `go run ./scripts/gen-icons`, committed |

To change the app icon: replace `appicon.png` (and the website's copy of it),
run `go run ./scripts/gen-icons`, and commit all four files.

**`wails build` will not do this for you.** It generates `windows/icon.ico`
from `appicon.png` only when that file is *missing*, so a stale one is used
forever and silently. That is exactly what happened here: the scaffolded
`icon.ico` was Wails' own "W" logo, and every Windows build shipped it long
after `appicon.png` had become the Konnekt mark. Deleting `icon.ico` and
letting Wails regenerate it would work, but then the icon that ships is not a
reviewable file in the repo.

macOS is the one platform with no committed artefact: Wails re-encodes the
`.icns` from `appicon.png` on every build, so there is nothing to keep in sync.
There is no macOS job in `.github/workflows/release.yml` yet, so that path only
runs on a developer's own machine.

## Mac

The `darwin` directory holds files specific to Mac builds.
These may be customised and used as part of the build. To return these files to the default state, simply delete them
and build with `wails build`.

The directory contains the following files:

- `Info.plist` - the main plist file used for Mac builds. It is used when building using `wails build`.
- `Info.dev.plist` - same as the main plist file but used when building using `wails dev`.

## Windows

The `windows` directory contains the manifest and rc files used when building with `wails build`.
These may be customised for your application. To return these files to the default state, simply delete them and
build with `wails build`.

- `icon.ico` - The icon compiled into the exe as its icon resource. See **Icons**
  above before replacing it: it is generated from `appicon.png`, and `wails build`
  only creates it when it is missing.
- `installer/*` - The files used to create the Windows installer. These are used when building using `wails build`.
- `info.json` - Application details used for Windows builds. The data here will be used by the Windows installer,
  as well as the application itself (right click the exe -> properties -> details)
- `wails.exe.manifest` - The main application manifest file.
