## What a run does {#run}

1. Check the lead time, the Distant Horizons config, its jar, its databases and the free space.
2. Read the previous snapshot: the destination's `latest.json`, or the `index.json` already in the staging folder.
3. Warn the players in chat at the lead time, and again at 1 minute and 10 seconds when the lead time is longer.
4. Stop the server, waiting up to the **Stop grace period** from Settings.
5. Read each dimension's database and stage the parts the previous snapshot lacks, then write `index.json`.
6. Start the server again, whether or not the copy worked.
7. Remove staged parts the new snapshot no longer needs.

> [!WARNING]
> This block stops a running server for the copy.
> A server that is already stopped is copied as it is, nobody is warned, and it stays stopped.

- The block holds this server's snapshot claim for the whole run.
- A snapshot or publish already running for the server fails it.
- Parts are slices of the databases, named by their hash.
- The warning goes over RCON, or through the server console when RCON is not confirmed.
- A warning that cannot be sent stops the run with the server still up.
- It leaves by **onComplete** when the snapshot is staged, and by **onFailed** on any error.
- **Staged folder**, **Bytes changed**, **Parts changed** and **Parts in all** are set after a successful run.
- **Downtime (s)** is set whenever the server was stopped, even if the run failed.

> [!NOTE]
> Progress and failures appear in the server's console.
> The block can run for up to 3 hours.

```flow
Cron Schedule: 0 4 * * 0
[onComplete]
* DH Snapshot: your destination
-> [onComplete · Staged folder] Publish DH Snapshot: same destination
-> [onFailed] Notify: Snapshot failed
```

```timeline
Lead time: Players read the first warning
-1 min: Second warning
-10 s: Last warning
* 0: The server stops and the data is copied
Copied: The server starts again
```

## Errors {#errors}

| Message says | Do |
| --- | --- |
| destination validation failed: DH Snapshot (*node*): the destination "*name*" does not exist. It was deleted or renamed in Settings, or this graph came from another install. | Pick a destination that exists, or clear the field. |
| no DistantHorizons.sqlite found under *world folder* | Let Distant Horizons create its data in the world first. |
| neither RCON nor the server's console can carry the warning, so the players could not be told before the stop: enable RCON (enable-rcon in server.properties) or start the server from Konnekt | Enable RCON, start the server from Konnekt, or set the lead time to 0. |
| cannot read the previous snapshot from *destination*: *reason* | Check the destination and the network, then run it again. |
| could not warn the players, so the server was not stopped: *reason* | Check RCON and the console; the server was left running. |
| could not stop the server: *reason* | Check the server's state, then run it again. |
| copying the databases failed: *reason* | Read the reason; the server was started again. |
| the snapshot was staged, but the server could not be started again: *reason* | Start the server by hand. |
| key prefix "*prefix*" must not contain "*segment*" | Remove the `.` or `..` segment from the prefix. |
| timed out after 10800s: *reason* | Run it again; the server is started again when the copy stops. |
