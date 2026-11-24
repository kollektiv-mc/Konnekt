## What a run does {#run}

1. Pause world saves, when the server is running.
2. Zip the chosen target.
3. Add the archive to the server's backups.
4. Resume world saves.
5. Leave by **onComplete**, or by **onFailed** on any error.

- **Full server** zips the whole server folder.
- **Active world** zips the `level-name` folder from `server.properties` with its `_nether` and `_the_end` folders.
- A stopped server is zipped as it is.
- The archive is named like `04817_21_10_26_142530.zip`: an id, then day, month, year and time.
- **Backup filename** carries the archive's file name after a successful run.

> [!WARNING]
> A running server's Distant Horizons databases are left out of the archive.
> Those are the `DistantHorizons.sqlite` files and their `-wal` and `-shm` companions.

```flow
Cron Schedule: 0 4 * * *
[onComplete]
* Create Backup: Full server
-> [onComplete] Notify: Backup done
-> [onFailed] Notify: Backup failed
```

## Errors {#errors}

| Message says | Do |
| --- | --- |
| a backup is already running for this server | Wait for the running backup or restore to finish. |
| could not pause world saves: *reason* | Enable RCON or start the server from Konnekt, so a save command can reach it. |
| server folder not found: *path* | Check the server's folder in its settings. |
| world folder "*name*" not found | Check `level-name` in `server.properties`. |
