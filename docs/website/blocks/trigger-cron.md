## What a run does {#run}

1. Once a minute, Konnekt checks the expression against the computer's clock.
2. On a match, the block fires.
3. The run leaves by **onComplete**.

- It fires at most once in any minute.
- An empty expression never fires.
- A field Konnekt cannot read never matches.
- A value wired into **Cron** is not read.
- The run acts on the server the graph belongs to.

> [!WARNING]
> An expression with any count of fields other than 5 never fires, and nothing reports it.

```flow
* Cron Schedule: 0 4 * * *
[onComplete]
Create Backup: Full server
```
