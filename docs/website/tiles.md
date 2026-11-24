---
title: Tiles
kind: reference
lead: Eleven tiles that show and control the selected server.
shelf: dashboard
order: 2
summary: What each tile shows and does.
facts:
  Topics: Tiles
related:
  - /docs/layouts.html
  - /docs/settings/appearance.html
  - /docs/first-server.html
---

## Console {#console}

Shows the selected server's log as it arrives.

- Type a command in the field and press **Send** once the server is running.
- **clr** clears the log.
- The arrow at the top left opens a search box and a level filter: **All**, **Warn** or **Error**.
- Maximized, it adds a Commands rail beside the log.

```ui
# Console
{command} | [*Send*] | [clr]
```

> [!TIP]
> Timestamps and the number of lines kept are set in [Console](/docs/settings/console.html).

## Overview {#overview}

Shows the server's state, then **Players**, **TPS**, **Uptime** and **Memory**.

- The state reads **Online**, **Offline**, **Starting**, **Stopping** or **Unreachable**.
- Maximized, it rolls up other tiles.
  It charts the last hour of CPU, RAM and players.
  Short views of **Players**, **Active world**, **Backups** and **Schedules** follow.
- Each short view has a button that opens its own tile.
- Overview only reads from the other tiles and changes nothing in them.

## Players {#players}

Shows how many players are online and lists them with their operator level.

- Click a player for their status, OP level, whitelist entry and ban reason.
- There, **kick** and **ban** work on online players and take an optional reason.
- **pardon** appears for a banned player.
- The list refreshes when anyone joins or leaves, and when the server starts or stops.
- Maximized, it adds a search box and sorting by **Name** or **OP level**.

## Commands {#quick-commands}

Shows one button per command, and a click runs it on the selected server.

- A first launch adds six: **Start**, **Stop**, **Restart**, **Force Stop**, **Save All** and **TPS**.
- **Force Stop** always asks first.
- **Stop** and **Restart** ask when **Confirm before stopping** is on in [General](/docs/settings/general.html#server).
- Maximized, it lists every button to rename, edit, copy, delete and reorder.
- Add one by typing a command, picking a preset, or linking a saved command from Kommands.

## Performance {#performance}

Shows TPS, CPU and RAM with a chart of recent samples.

- Konnekt takes a sample every 10 seconds and keeps the last hour.
- Maximized, the chart covers **5m**, **15m** or **1h**.
- Click a series in its legend to hide it.
- A table lists each sample, sortable by any column, with a min·avg·max row.

## Scheduler {#scheduler}

Shows how many graphs are armed and when the next one runs.

- Maximized, it opens the graph editor.
- Graphs are covered in [How a graph runs](/docs/graphs.html) and [Scheduler editor](/docs/scheduler-editor.html).

## Worlds {#worlds}

Shows how many worlds the server has, their total size and which one is active.

- Maximized, it draws each world as a planet in a 3D scene.
- Click one to open its card: **set active**, **backup**, **open folder**, **rename**, **duplicate** and **delete**.
- **set active** on a running server offers to stop it first, and to start it again after.
- **delete** is missing for the active world and off while the server runs.
- The card also lists the world's backups, each with **restore** and **delete**.

## Backups {#backups}

Shows **Last full backup**, its size and how many archives are kept.

- **Back up now** takes a full server backup.
  On a running server it asks whether to back up now or stop the server first.
- Maximized, it lists backups under **Server** and **Worlds**.
  Each can be renamed, tagged and deleted.
- **restore** needs the server stopped.
- **schedule** opens the Scheduler, where the [Backup](/docs/blocks/action-backup.html) block runs backups on a timer.

```ui
# Backups
Last full backup
[*Back up now*]
```

## Config {#server-config}

Shows the MOTD as players see it, then the main `server.properties` values, as many as fit.

- The rest are counted in the last cell, and the RCON password is hidden.
- Click an on/off value to flip it, and a value with fixed choices to cycle through them.
- Double-click any other value to edit it.
- Each change is written to the file at once.
- Maximized, it lists the server, plugin and mod config files, with a search box.
- A file opens in a **Form** or **Raw** editor, with **Save** and **Revert**.
- A file the form cannot edit safely opens as **Raw** only.

> [!NOTE]
> On a running server, changes apply after a restart.

## Notifications {#notifications}

Lists events as they happen: joins, info, warnings, errors and crashes.

- The filter at the top left narrows it to **Joins**, **Info**, **Warn** or **Errors**.
- **Clear all** empties the list.
- It keeps the latest 200 until Konnekt closes.

> [!TIP]
> Which events also raise a bubble or a desktop alert is set in [Notifications](/docs/settings/notifications.html).

## Plugins {#mods}

Lists the server's installed plugins, or its mods on a server that does not load plugins, as many as fit.

- A green dot is on, a grey one is off, and an orange one has an update.
- What does not fit is counted in the last cell.
- While the server runs, the tile says **restart needed** for changes.
- Maximized, each one switches on or off, by renaming its file between `.jar` and `.jar.disabled`.
- **Add Content** searches Modrinth, or CurseForge once you add an API key in Settings, and installs from it.
- A mod whose author allows downloads on CurseForge only links to its page there instead.
- **Add Files** adds jars from this computer, in the desktop app.
