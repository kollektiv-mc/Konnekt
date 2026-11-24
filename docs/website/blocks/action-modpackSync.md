## What a run does {#run}

1. Make the same plan **Check Modpack** makes, downloading what is missing.
2. Fail if the plan has any blocker, since nobody is there to read it.
3. Keep a copy of every file it replaces or removes, so the sync can be rolled back from the mods tile.
4. Move the new files into `mods/`.

> [!WARNING]
> This block does not stop the server.
> Put a **Command** set to **Stop Server** before it and one set to **Start Server** after.

- The pack is the one chosen in the mods tile, under **Pack**.
- Only files the pack installed are replaced or removed.
- A mod added by hand stays.
- It leaves by **onComplete** when files changed, by **onUpToDate** when none had to, and by **onFailed** on any error.

> [!NOTE]
> The result appears in the server's console.
> The block can run for up to 30 minutes.

```flow
Cron Schedule: 0 5 * * *
[onComplete]
Check Modpack
[onUpdate]
Command: Stop Server
[onComplete]
* Sync Modpack
-> [onComplete · onUpToDate · onFailed] Command: Start Server
```

## Errors {#errors}

| Message says | Do |
| --- | --- |
| no pack is set for this server | Choose a pack in the mods tile, under **Pack**. |
| pack sync is for mod loaders; this server runs *loader* | Pack sync is for mod loaders such as NeoForge and Fabric. |
| read the pack: *reason* | Check the pack address and the network, then run it again. |
| the sync cannot be applied: The server is running. Stop it to apply the sync. | Stop the server before this block. |
| the sync cannot be applied: The pack expects *loader version* and the server runs *version*. | Update the server's loader to the pack's version. |
| the sync cannot be applied: *file*: a CurseForge file the pack does not link directly | Put that jar in `mods/` by hand, then run it again. |
