## What a run does {#run}

1. Konnekt checks time triggers once a minute.
2. The first check that sees the block starts its timer and does not fire.
3. Each later check fires the block once the interval has passed since its last firing.
4. The run starts at this block and leaves by **onComplete**.

- The block has no cooldown: the interval spaces the runs.
- A value wired into **Interval** is not read.
- The run acts on the server the graph belongs to.

> [!WARNING]
> The timer is kept in memory, so closing Konnekt resets it.

```flow
* Interval: 60 min
[onComplete]
Create Backup: Full server
```
