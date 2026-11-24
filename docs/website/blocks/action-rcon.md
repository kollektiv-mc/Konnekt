## What a run does {#run}

1. Use the wired **Command** if there is one, otherwise the field.
2. Connect to the server's RCON port.
3. Log in.
4. Send the command.
5. Close the connection.
6. Leave by **onComplete** with the reply in **Response**, or by **onFailed** on any error.

- Each run opens a new connection.
- **Response** has colour codes removed and spaces trimmed.
- **Response** can be empty.
- The presets match the console presets of the [Command block](/docs/blocks/action-command.html).

> [!WARNING]
> The address and password are the ones `server.properties` held when the server last started.
> They count only if `enable-rcon` was `true` and `rcon.password` was set.
> A change made while the server runs does not apply until it restarts.

```flow
Cron Schedule: 0 4 * * *
[onComplete]
* RCON Command: Save All
-> [onComplete] Notify: Saved
-> [onFailed] Notify: RCON failed
```

## Errors {#errors}

| Message says | Do |
| --- | --- |
| command is empty | Fill in **Command**, or wire a value into it. |
| RCON not enabled or not running | Set `enable-rcon` and `rcon.password` in `server.properties`, then start the server. |
| rcon dial: *reason* | Check that the server is running and that `rcon.port` is right. |
| rcon auth: wrong password | Check `rcon.password` in `server.properties`, then restart the server. |
