## What a run does {#run}

1. While the server runs, Konnekt takes a stats snapshot every 10 seconds.
2. If the snapshot's TPS is below **TPS threshold** and the cooldown has passed, the block fires.
3. The run leaves by **onComplete**, and **Current TPS** carries that snapshot's value.

- The server's TPS comes from RCON, polled every 15 seconds, and is capped at 20.
- Without RCON it is estimated from the server's `Can't keep up` warnings.
- A value wired into **Threshold** or **Cooldown** is not read.
- The block fires only for the server the graph belongs to.

> [!WARNING]
> A long dip fires again each time the cooldown passes.

```flow
* TPS Below Threshold: 14
[onComplete · Current TPS]
Notify: Server is lagging
```
