## What a run does {#run}

1. Once a minute, Konnekt compares the computer's clock with the **Time (HH:MM)** field.
2. When the hour and minute match, the block fires.
3. The run leaves by **onComplete**.

- It fires at most once per calendar day.
- A value wired into **Time** is not read.
- The run acts on the server the graph belongs to.

> [!WARNING]
> Konnekt must be running at that minute.
> A missed time is not made up.

```flow
* Time of Day: 04:00
[onComplete]
Create Backup: Full server
```
