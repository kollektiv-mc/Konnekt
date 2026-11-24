---
title: Keep a server in sync with a modpack
kind: guide
lead: Point a modded server at a packwiz pack, check what changed, apply it, and roll it back.
shelf: tutorials
order: 6
summary: Check, apply and schedule pack updates.
facts:
  Duration: ~10 min
  Requirements: A modded server · A packwiz pack
  Topics: Mods · Scheduler
related:
  - /docs/blocks/action-modpackCheck.html
  - /docs/blocks/action-modpackSync.html
  - /docs/tiles.html
  - /docs/timed-restart.html
---

## Before you start

- [ ] A server on a mod loader
      Such as NeoForge or Fabric, on the Minecraft version the pack is for.
- [ ] A packwiz pack
      The `https` address of its `pack.toml`, or a folder on this computer that holds it.

## What a sync does

- A sync makes the server's `mods/` folder match the pack.
- It adds and updates the pack's jars, and removes the ones the pack dropped.
- It only replaces or removes files the pack installed.
  A mod you added by hand stays.
- Client-only mods in the pack are skipped.
- Every downloaded jar is checked against the pack's hash before it is used.

> [!WARNING]
> Only the jars in `mods/` are synced.
> Config files and anything else in the pack are not copied.

```flow
Pack: pack.toml
[Check]
Plan: what would change
[Apply]
mods/: matches the pack
[Roll back]
mods/: as it was before
```

## Choose the pack

1. Maximize the server's mods tile.
2. Select **Pack**.
3. Pick **URL** or **Folder**.
4. Enter the address of `pack.toml`, or select **Browse** to pick the folder.
5. Select **Save**.

> [!NOTE]
> A URL must start with `https://` and end in `/pack.toml`.
> Plain `http` works only for an address on this computer, such as `packwiz serve`.

```ui
# Mods
42 mods | [*Pack*] | [Add Files] | [Add Content]
```

```ui
# Pack
[*URL*] | [Folder]
{*https://…/pack.toml*}
[Save]
```

## Check what would change

1. Select **Check**.
2. Read the summary line, then the rows.

> [!NOTE]
> Check downloads the jars the server lacks into Konnekt's cache.
> It does not touch `mods/`.

| Row | Means |
| --- | --- |
| **add** | The pack has it and the server does not. |
| **update** | A new version replaces the server's copy. |
| **remove** | The pack installed it and no longer lists it. |
| **disable** | Excluded here or client only, so the server's copy is switched off. |
| **keep** | Already up to date. |
| **adopt** | The exact file is already on the server, and the sync takes it over. |
| **skip** | Not for this server, such as a client-only mod. |
| **blocked** | It cannot be downloaded: the row says why. |

```ui
# Pack
My Pack 1.4.0 | [Roll back] | [*Check*] | [Apply]
2 to add, 1 to update, 0 to remove, 0 to disable.
```

## Pick what this server installs

1. Hover over a row.
2. Select **Exclude** to keep that mod off this server.
3. On a skipped client-only row, select **Install here** to install it anyway.
4. Select **Reset** on a row to undo either choice.

> [!NOTE]
> The choices belong to this server, and the plan is made again after each one.

## Apply the sync

1. Stop the server.
2. Select **Check** again.
3. Select **Apply**.
4. Start the server.

> [!WARNING]
> **Apply** stays greyed out while a red line shows above the rows.
> A running server is one: stop it first.

> [!NOTE]
> The new jars are already downloaded and checked, so applying only moves files.
> If the pack or `mods/` changed since the check, nothing is applied: check again.

## Roll back

1. Stop the server.
2. Select **Roll back**.

> [!NOTE]
> Each press undoes the newest sync not yet undone, up to the last 3 syncs.
> The files it added go, and the files it replaced or removed come back.

## Sync on a schedule

1. Maximize the Scheduler tile to open the [scheduler editor](/docs/scheduler-editor.html), and select **New graph**.
2. Add **Cron Schedule** and set **Cron expression** to `0 5 * * *`.
3. Under **action**, open the **Modpack** group and add **Check Modpack**.
   Wire **onComplete** on **Cron Schedule** to its **trigger**.
4. Add a **Command** set to **Stop Server**, and wire **onUpdate** on **Check Modpack** to its **trigger**.
5. Add **Sync Modpack** from the same group, and wire **onComplete** on the stop **Command** to its **trigger**.
6. Add a **Command** set to **Start Server**.
7. Wire **onComplete**, **onUpToDate** and **onFailed** on **Sync Modpack** to its **trigger**.
8. Save the graph and select **[on]**.

> [!WARNING]
> **Stop Server** stops the server with players on it.
> Pick an hour with few players, or warn them first as in [Warn, then restart every 6 hours](/docs/timed-restart.html).

> [!NOTE]
> The server only stops on days the pack changed.
> A sync with any red line fails, and the server starts again on the old mods.

```flow
Cron Schedule: 0 5 * * *
[onComplete]
Check Modpack
[onUpdate]
Command: Stop Server
[onComplete]
Sync Modpack
[onComplete · onUpToDate · onFailed]
Command: Start Server
```

## When it refuses

| Message says | Do |
| --- | --- |
| pack address: must end in /pack.toml | Use the address of the `pack.toml` file itself. |
| no pack.toml in *folder* | Pick the folder that holds `pack.toml`. |
| pack sync is for mod loaders; this server runs *loader* | Use pack sync on a NeoForge, Fabric or other mod loader server. |
| The pack is for Minecraft *version* and the server runs *version*. | Point the server at a pack for its version. |
| The pack expects *loader* *version* and the server runs *version*. Update the server's loader first. | Update the server's loader to the pack's version. |
| *file*: a CurseForge file the pack does not link directly | Put that jar in `mods/` by hand, then select **Check** again. |
| the pack or the mods folder changed since this plan was made; check again | Select **Check**, then **Apply**. |
| the server is running; stop it to roll back | Stop the server, then select **Roll back**. |
