## What a run does {#run}

1. Use the wired **Command** if there is one, otherwise the field.
2. Leave by **onFailed** if the value is empty.
3. Run the value.
4. Leave by **onComplete** when the action is done, or by **onFailed** if it errors.

- **Start Server** (`__start__`) launches the server with its saved jar, JVM arguments and working folder.
- **Start Server** leaves as soon as the process is launched, not when the server is ready.
- **Stop Server** (`__stop__`) stops the server and waits for it to exit.
- **Stop Server** waits up to the **Stop grace period** in Settings, then force-ends the process.
- **Restart Server** (`__restart__`) stops, then starts.
- **Restart Server** on a stopped server only starts.
- Any other value is written to the server console as one line.
- For a console line, **onComplete** means the line was written and the server's reply is not read.
- **Command sent** carries the value that ran, such as `__stop__` for **Stop Server**.
- **Command sent** is set only when the block succeeds.

> [!WARNING]
> **Stop Server** and **Restart Server** disconnect every player.
> **Stop Server** force-ends the process once the **Stop grace period** runs out.

> [!NOTE]
> The presets **Save All**, **Freeze Time**, **Set Day** and **Set Night** send `save-all`, `time set 18000`, `time set day` and `time set night`.

```flow
Cron Schedule: 0 4 * * *
[onComplete]
* Command: Save All
-> [onComplete] Notify: Saved
-> [onFailed] Notify: Save failed
```

## Errors {#errors}

| Message says | Do |
| --- | --- |
| command is empty | Fill in **Command**, or wire a value into it. |
| server already running | Use **Start Server** only while the server is stopped. |
| server not running | Make sure the server is up when this block runs. |
| another power action is in progress | Wait for the running start, stop or restart to finish. |
| command must be a single line | Remove the line break from the command. |
| failed to start server: *reason* | Fix what the reason names, then run again. |
