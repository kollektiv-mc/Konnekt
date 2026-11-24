## What a run does {#run}

1. Read and check `index.json` in the staged folder.
2. Read the bucket's `latest.json` to learn which parts are already there.
3. Send the parts the bucket lacks, and count a part it already holds as skipped.
4. Write the snapshot's `index.json`, then `latest.json` last.
5. Delete snapshots beyond **Snapshots to keep**, and the parts no kept snapshot uses.

> [!WARNING]
> Step 5 deletes snapshots and parts from the bucket.
> The newest complete snapshots are kept, plus the one `latest.json` points at.

- The block holds this server's snapshot claim for the whole run.
- A snapshot or publish already running for the server fails it.
- A wired **Staged folder** replaces the **Staged folder** field.
- A run that stops before `latest.json` is written leaves the previous snapshot as the current one.
- The next run resumes, because parts already in the bucket are not sent again.
- It leaves by **onComplete** once `latest.json` is written, and by **onFailed** on any error.
- A prune that fails does not fail the block: it leaves by **onComplete** and records a warning.
- **Snapshot URL** is the address of `latest.json`, under the destination's public base URL if it has one.
- **Parts uploaded**, **Parts skipped**, **Bytes sent**, **Snapshots deleted**, **Parts deleted** and **Bytes freed** count what the run sent and what the prune removed.

> [!NOTE]
> A private link shows `[redacted]` in place of its token.
> Copy that link from the destination's **Snapshot link** row in Settings.
> Progress and failures appear in the server's console.
> The block can run for up to 12 hours.

```flow
Cron Schedule: 0 4 * * 0
[onComplete]
DH Snapshot: your destination
[onComplete · Staged folder]
* Publish DH Snapshot: same destination
-> [onComplete] Notify: Snapshot published
-> [onFailed] Notify: Publish failed
```

## Errors {#errors}

| Message says | Do |
| --- | --- |
| destination validation failed: Publish DH Snapshot (*node*): the destination "*name*" does not exist. It was deleted or renamed in Settings, or this graph came from another install. | Pick a destination that exists, or add it in Settings. |
| key prefix "*prefix*" must not contain "*segment*" | Remove the `.` or `..` segment from the prefix. |
| the staged folder *folder* cannot be read: *reason* | Check that the folder exists and can be read. |
| cannot read the previous snapshot from *destination*: *reason* | Check the destination and the network, then run it again. |
| part *hash*: *reason* | Run it again; parts already sent are skipped. |
| timed out after 43200s: *reason* | Run it again; parts already sent are skipped. |
