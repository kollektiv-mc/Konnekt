## What a run does {#run}

1. The server starts, stops or crashes.
2. The block fires when the event matches its **Type**, unless its cooldown has not passed.
3. The run starts at this block and leaves by **onComplete**.

- **Started** fires when Konnekt launches the server process.
- **Stopped** fires when the process exits after a deliberate stop, from Konnekt or from the server itself.
- **Crashed** fires when it exits any other way, or after the server logged a crash.
- A restart from Konnekt fires **Stopped**, then **Started**.
- The block has no data outputs.
- The cooldown counts per block.
- A value wired into **Cooldown** is not read.
- The block fires only for the server the graph belongs to.

> [!WARNING]
> **Started** fires before the server has finished loading.

```flow
* Server: Crashed
[onComplete]
Notify: Server crashed
```
