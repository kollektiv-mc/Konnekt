![Konnekt](docs/images/konnekt_banner.png)

# Konnekt
(Alpha)

## About

Konnekt is a cross-platform desktop control panel for self-hosted Minecraft servers. It wraps everything you'd normally do through a raw console, RCON, or SSH — starting servers, watching logs, managing worlds, scheduling backups, installing mods — into a single native app with a modular, drag-and-drop dashboard.

It's built for Minecraft server admins and hobbyists who self-host vanilla, Paper/Spigot/Bukkit, or modded Fabric/Forge servers and want a real GUI instead of stitching together terminal windows and plugins.

> **Status:** Alpha. Core management, scheduling, worlds, backups, and mods are functional; see [Roadmap](#roadmap) for what's still coming.
> 
## Fair warning

This is a personal side project which was built to run my own Minecraft servers the way I want, rather than to match what a wider community might expect from it. Most of the code comes from Claude, with me reading over its shoulder rather than writing it myself; I'm not a programmer, just someone putting AI tools to use for something I needed. So don't expect a polished, textbook-clean codebase. It works for me, and that's the bar I'm holding it to.

I have no interest in gatekeeping any of this, so take the code and do what you want with it — fork it, extend it, rebuild it, whatever. It's released under [CC0](LICENSE), so there's no copyright to ask permission from.

## Features

### Multi-server management (Alpha)

Add and configure any number of server instances — jar path, JVM arguments, working directory — and start, stop, or restart them independently, with a guided EULA acceptance flow for first-time setup.

### Live console

Stream server logs in real time, send commands directly, and set up your own quick-command buttons for the actions you run most.

![Live console](docs/images/live-console.png)

### Stats & performance

Keep an eye on TPS, RAM usage, player count, and uptime at a glance, with a rolling performance history chart to spot trends and troubleshoot lag.

### Player management

See who's online and kick, ban, or pardon players without leaving the dashboard.

### Visual scheduler

A node-based automation editor: wire up triggers (a player joining or leaving, the server stopping, TPS dropping below a threshold, a cron/interval/time-of-day schedule) to actions (run a console command, send an RCON command, trigger a backup, make an HTTP request, wait, start/stop/restart the server) and control/data blocks (conditions, math, randomness, server attributes). Runs are tracked with history and next-run predictions.

![Visual scheduler](docs/images/visual-scheduler.png)

### World management

A 3D visualizer for navigating your server's worlds and dimensions — switch the active world, rename, duplicate, delete, back up individual worlds, and inspect NBT metadata.

![World management](docs/images/world-management-1.png)
![World management](docs/images/world-management-2.png)

### Backups

Manual or scheduled backups of full servers or individual worlds, with safe restore (validated paths, extract-then-swap), progress feedback, and history.

![Backups](docs/images/backups.png)

### Server config editor

Browse and edit `server.properties` and other config files (JSON/YAML/TOML) through a form view or raw text editor.

![Server config editor](docs/images/server-config.png)

### Mods & plugins

Browse and search Modrinth from inside the app, resolve dependencies, install or uninstall, enable/disable, check for updates, or install a local jar. Konnekt detects your server's loader (Fabric, Forge, Paper, etc.) automatically.

![Mods and plugins](docs/images/mods-plugins.png)

### Customizable tile dashboard

Every feature lives in a draggable, resizable tile that snaps to a grid. Stash tiles you're not using in the crate, maximize the ones you need, and save named layout presets.

![Tile dashboard](docs/images/tile-dashboard.png)

### Notifications

An in-app notification feed plus native OS desktop notifications for crashes, joins/leaves, backup completion, TPS drops, and scheduler events.

## Compatibility

Konnekt integrates with popular server mods and plugins to extend its core features. Click a mod to see feature-level detail.

### Compatible

<details>
<summary><img src="docs/images/mod-icon-placeholder.svg" width="20" height="20" align="absmiddle"> <strong>Multiverse</strong></summary>

- Multi-World & Dimension management

</details>

### Planned

<details>
<summary><img src="docs/images/mod-icon-placeholder.svg" width="20" height="20" align="absmiddle"> <strong>Multiverse</strong></summary>

- Visual world connections
- In-world portal & sign management

</details>

<details>
<summary><img src="docs/images/mod-icon-placeholder.svg" width="20" height="20" align="absmiddle"> <strong>BlueMap</strong></summary>

- Map viewer integration

</details>

<details>
<summary><img src="docs/images/mod-icon-placeholder.svg" width="20" height="20" align="absmiddle"> <strong>WorldGuard</strong></summary>

- Region protection integration

</details>

## Why Konnekt

- **Local-first.** All app state is stored locally on disk — no account, no cloud dependency, no telemetry required to run your server.
- **Cross-platform.** Built on [Wails](https://wails.io/); tagged releases ship a Windows build, the rolling snapshot channel adds Linux and an `.rpm` (see [Platform support](#platform-support)), and it also runs as a native app on macOS from source.
- **One dashboard, not ten tools.** Console, stats, scheduling, worlds, backups, config, and mods all live in the same window instead of separate scripts and plugins.

## Tech stack

- **Backend:** Go, via [Wails v2](https://wails.io/) for native windowing and Go↔JS bindings
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4
- **State:** Zustand
- **Visual scheduler:** [React Flow](https://reactflow.dev/) on the frontend, a graph execution engine in Go on the backend
- **World visualizer:** three.js / @react-three/fiber
- **Config editing:** CodeMirror

## Platform support

Prebuilt binaries come from two channels: tagged releases, and the rolling
`snapshot` prerelease rebuilt from `main`. Both are on the
[releases page](https://github.com/kollektiv-mc/Konnekt/releases); the snapshot
is a prerelease, so GitHub keeps it out of the default view.

- **Windows** (`konnekt-windows-amd64.exe`) — tagged releases and snapshots.
- **Linux** (`konnekt-linux-amd64`, plus an `.rpm` for Rocky/RHEL 10 and
  Fedora) — **snapshots only so far.** The release workflow builds both, but
  those jobs landed after the one tagged release was cut, so the next tag is
  the first to carry them. They are built against webkit2gtk-4.1, which covers
  Rocky/RHEL 10, Fedora 36+, Ubuntu 22.04+, and Debian 12+. **Rocky/RHEL 9 is
  not supported**: EL9 never received webkit2gtk-4.1, and EL10 dropped
  webkit2gtk-4.0, so the two are not binary-compatible.
- **macOS** is not published on either channel, but builds from source via
  `wails build` like any other platform.

## Getting started

Requires [Go](https://go.dev/), [Node.js](https://nodejs.org/) with [pnpm](https://pnpm.io/), and the [Wails CLI](https://wails.io/docs/gettingstarted/installation). On Linux you'll also need `webkit2gtk` and `gtk3` development packages — run `wails doctor` to see exactly what's missing for your distro.

```bash
# install dependencies
pnpm install

# run in development mode with hot reload
wails dev

# build a production binary
wails build
```

## Roadmap

See [`agent_docs/ROADMAP.md`](agent_docs/ROADMAP.md) for the full scope.

## Contributing

Bug reports and feature requests go through
[GitHub Issues](https://github.com/kollektiv-mc/Konnekt/issues/new/choose), which
offers a short form for each. You do not need to be technical to file a good
one: the forms ask only for things you can see, everything technical is
optional, and a screenshot is often worth more than any of it.

[`CONTRIBUTING.md`](CONTRIBUTING.md) covers what happens to an issue after you
file it and how to send code. To report a vulnerability privately, see
[`SECURITY.md`](SECURITY.md) rather than opening an issue.

## Documentation

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to report a bug, request a feature, or send code
- [`SECURITY.md`](SECURITY.md) — supported versions and how to report a vulnerability
- [`agent_docs/CLAUDE.md`](agent_docs/CLAUDE.md) — architecture and stack overview
- [`agent_docs/ROADMAP.md`](agent_docs/ROADMAP.md) — full feature roadmap
- [`agent_docs/DEPENDENCIES.md`](agent_docs/DEPENDENCIES.md) — dependency notes
- [`agent_docs/HEALTH_CHECKLIST.md`](agent_docs/HEALTH_CHECKLIST.md) — codebase health checklist (evergreen yardstick + open backlog)
- [`agent_docs/HEALTH_LOG.md`](agent_docs/HEALTH_LOG.md) — completed remediation history
