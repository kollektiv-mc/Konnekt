## What a run does {#run}

1. Use the wired value if there is one, otherwise **Seconds**.
2. Wait that long.
3. Leave by **onComplete**.

- The block has no data outputs.
- A wait longer than 60 seconds is cut off and leaves by **onFailed**.

> [!NOTE]
> Chain two **Delay** blocks for a longer wait.

```flow
Cron Schedule: 0 4 * * *
[onComplete]
Command: say Restart in 1 minute
[onComplete]
* Delay: 60
[onComplete]
Command: Restart Server
```

## Errors {#errors}

| Message says | Do |
| --- | --- |
| timed out after 60s: delay cancelled: context deadline exceeded | Use 60 seconds or less in one block. |
