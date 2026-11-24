## What a run does {#run}

1. Konnekt reads the console of a server it started.
2. **Joined** fires the block when a player joins, and **Left** when one leaves.
3. The run starts at this block and leaves by **onComplete**.

- **Player name** carries the player's name.
- **Player IP** carries the address on **Joined**.
- **Player IP** is empty on **Left**.
- **Player IP** can also be empty on **Joined**, when the server logs the address after the join message.
- A value wired into **Cooldown** is not read.
- The block fires only for the server the graph belongs to.

> [!WARNING]
> The cooldown counts per block, not per player.
> A player who joins inside the cooldown does not start a run.

```flow
* Player: Joined
[onComplete · Player name]
Notify: Player joined
```
