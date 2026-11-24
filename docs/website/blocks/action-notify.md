## What a run does {#run}

1. Use the wired **Message** if there is one, otherwise the field.
2. Read **Kind** and **Deliver to**.
3. Send one message to the app.
4. Leave by **onComplete** at once.

- The block has no **onFailed** port.
- **In-app** adds the message to the Notifications tile and raises a bubble titled Scheduler.
- **Desktop** sends the operating system's notification only.
- **In-app and desktop** does both.
- An empty or unknown **Deliver to** value sends **In-app and desktop**.

> [!WARNING]
> **Desktop** shows nothing if the operating system denies permission.
> The first desktop notification can ask for it.

> [!NOTE]
> The bubble is hidden when its switch is off in the **Notifications** pane of **Settings**.
> Kind **Error** uses **Errors**, and the other kinds use **Warnings and info**.
> No switch in Settings applies to **Desktop**.

```flow
Cron Schedule: 0 4 * * *
[onComplete]
Create Backup: Full server
[onComplete]
* Notify: Backup done
```
