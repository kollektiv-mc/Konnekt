## What a run does {#run}

1. A block that uses **Value** runs.
2. This block reads the **Attribute** once per run.
3. It checks the value against **Data type**.
4. It passes **Value** to that block.

- This block has no control ports.
- Every block using the same **Read Attribute** in that run gets the same value.

```flow
Cron Schedule: 0 4 * * *
[onComplete]
Condition: A == 0
<- * Read Attribute: players.count
-> [onTrue] Create Backup: Full server
```

| Attribute | Value |
| --- | --- |
| `tps` | The server's current ticks per second. |
| `players.count` | The number of players online. |
| `players.max` | The server's player limit. |
| `ram.used (MB)` | The memory the server process uses, in MB. |
| `ram.total (MB)` | The `-Xmx` memory limit of the server, in MB. |
| `ram.left (MB)` | `ram.total` minus `ram.used`, in MB. |
| `server.status` | `1` when the server is running, `0` when it is stopped. |
| `server.whitelist` | The `white-list` value in `server.properties`, as text. |
| `server.port` | The `server-port` value in `server.properties`, as text. |
| `server.gamemode` | The `gamemode` value in `server.properties`, as text. |
| `server.motd` | The `motd` value in `server.properties`, as text. |
| `server.world` | The `level-name` value in `server.properties`, as text. |

> [!WARNING]
> A value of the wrong type, or an attribute that cannot be read, sets no output, and no error is shown.
> The block that would use the value uses its own field instead.

> [!NOTE]
> A name that is not built in is looked up among the custom attributes set earlier in the run.
> [Write Attribute](/docs/blocks/data-writeAttribute.html) sets them.

| Data type | Accepts |
| --- | --- |
| Auto | Any value. The **Value** port then connects to any input. |
| Number | A number. |
| Boolean | A boolean, or `1` or `0`. |
| String | Text. |
