## What a run does {#run}

1. A backup finishes or fails.
2. The block fires, unless its cooldown has not passed.
3. The run leaves by **onComplete** after a finished backup, and by **onFailed** after a failed one.

- Backups of one world and backups made by a **Create Backup** block count too.
- **Backup filename** carries the new file's name on **onComplete**.
- **Backup filename** is not set on **onFailed**.
- One cooldown covers both ports.
- A value wired into **Cooldown** is not read.
- A failed restore does not fire the block.
- The block fires only for the server the backup belongs to.

> [!WARNING]
> A backup inside the cooldown starts no run, finished or failed.

```flow
* Backup: 300 s cooldown
[onComplete · Backup filename]
Notify: Backup done
-> [onFailed] Notify: Backup failed
```
