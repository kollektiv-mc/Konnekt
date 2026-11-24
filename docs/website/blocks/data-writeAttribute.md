## What a run does {#run}

1. Reads the **Attribute** name. A leading `@` is ignored.
2. Reads the value. A wired **Value** replaces the **Value** field.
3. Writes a built-in attribute to `server.properties` in the server's folder, or defines any other name as a custom attribute.
4. Leaves by **onComplete** when the attribute is written or defined.

- It leaves by **onFailed** on an error.

```flow
Cron Schedule: 0 4 * * *
[onComplete]
* Write Attribute: server.motd
<- Constant: Back at 05:00
-> [onFailed] Notify: Write failed
```

> [!WARNING]
> The block does not restart the server.
> A running server reads `server.properties` again only when it next starts.

| Attribute | Writes |
| --- | --- |
| `players.max` | `max-players` |
| `server.motd` | `motd` |
| `server.whitelist` | `white-list`, and sends `whitelist on` to a running server for `true` or `1`, otherwise `whitelist off` |
| `server.port` | `server-port` |
| `server.gamemode` | `gamemode`, and sends `defaultgamemode` with the value to a running server |
| `server.world` | `level-name` |

- The read-only attributes fail the block: `tps`, `players.count`, `ram.used`, `ram.left`, `ram.total` and `server.status`.
- Any other name defines a custom attribute for the rest of this run.
- Its value is kept as typed.
- An `@attribute` inside it is read again each time the custom attribute is used.

> [!NOTE]
> The custom attribute is gone when the run ends.
> [Read Attribute](/docs/blocks/data-serverAttribute.html) reads it.

## Errors {#errors}

| Message says | Do |
| --- | --- |
| attribute @*name* is read-only | Choose one of the writable attributes. |
| property value must be a single line | Remove the line breaks from the value. |
