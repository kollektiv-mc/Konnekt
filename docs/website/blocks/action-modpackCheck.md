## What a run does {#run}

1. Read the pack and check every file in it against the pack's hashes.
2. Download each jar the server lacks into Konnekt's cache, checked against its hash.
3. Work out what a sync would add, update, remove and disable, without touching `mods/`.

- The pack is the one chosen in the mods tile, under **Pack**.
- The block takes no address of its own.
- It leaves by **onUpdate** when a sync would change a file, by **onUpToDate** when it would not, and by **onFailed** on any error.
- **Applied version** is the pack version last synced, empty before the first sync.

> [!NOTE]
> The block can run for up to 30 minutes.

```flow
Cron Schedule: 0 5 * * *
[onComplete]
* Check Modpack
-> [onUpdate] Notify: Modpack update ready
-> [onUpToDate] Notify: Modpack is current
-> [onFailed] Notify: Modpack check failed
```

## Errors {#errors}

| Message says | Do |
| --- | --- |
| no pack is set for this server | Choose a pack in the mods tile, under **Pack**. |
| pack sync is for mod loaders; this server runs *loader* | Pack sync is for mod loaders such as NeoForge and Fabric. |
| read the pack: *reason* | Check the pack address and the network, then run it again. |
