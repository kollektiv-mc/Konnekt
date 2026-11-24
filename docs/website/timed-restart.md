---
title: Warn, then restart every 6 hours
kind: guide
lead: Tell players a restart is coming, then restart the server every 6 hours.
shelf: tutorials
order: 3
summary: Warnings in chat, then a restart.
facts:
  Duration: ~8 min
  Requirements: A running server · An open Konnekt
  Topics: Scheduler · Console
related:
  - /docs/blocks/trigger-interval.html
  - /docs/blocks/action-delay.html
  - /docs/blocks/action-command.html
  - /docs/cron.html
---

## Before you start

- [ ] Konnekt left open
      Graphs run only while Konnekt is open.
      The 6-hour timer lives in memory, so closing Konnekt resets it.
- [ ] The scheduler editor
      Maximize the Scheduler tile to open it.

## What you build {#what-you-build}

Five blocks that warn twice, then restart the server every 6 hours.

```flow
Interval: 360 minutes
[onComplete]
Command: say The server restarts in 1 minute.
[onComplete]
Delay: 50 s
[onComplete]
Command: say The server restarts in 10 seconds.
[onComplete]
Delay: 10 s
[onComplete]
Command: Restart Server
```

```timeline
-60 s: say The server restarts in 1 minute
-10 s: say The server restarts in 10 seconds
0: Restart Server
```

## Add the trigger

1. Open the editor and select **Open blocks**.
2. Under **trigger**, click [Interval](/docs/blocks/trigger-interval.html).
3. Set **Interval (minutes)** to `360`.

> [!NOTE]
> The first check that sees the graph on starts the timer.
> The first restart comes 6 hours after that.
> For fixed times, use [Cron Schedule](/docs/blocks/trigger-cron.html) with `0 */6 * * *` instead.

```flow
* Interval: 360 minutes
```

## Warn the players

1. Add two [Command](/docs/blocks/action-command.html) blocks and two [Delay](/docs/blocks/action-delay.html) blocks.
2. On the first **Command**, set **Command** to `say The server restarts in 1 minute.`
3. On the first **Delay**, set **Seconds** to `50`.
4. On the second **Command**, set **Command** to `say The server restarts in 10 seconds.`
5. On the second **Delay**, set **Seconds** to `10`.
6. Drag from **onComplete** on **Interval** to **trigger** on the first **Command**.
7. Wire each remaining block's **onComplete** to the next block's **trigger**, in the order of steps 2 to 5.

> [!NOTE]
> One **Delay** waits 60 seconds at most, and a longer wait fails.
> For an earlier warning, chain more **Delay** blocks.

```flow
Interval: 360 minutes
[onComplete]
* Command: say The server restarts in 1 minute.
[onComplete]
* Delay: 50 s
[onComplete]
* Command: say The server restarts in 10 seconds.
[onComplete]
* Delay: 10 s
```

## Add the restart

1. Add a third **Command**.
2. Set **Command** to **Restart Server**.
3. Drag from **onComplete** on the last **Delay** to **trigger** on the new **Command**.

> [!NOTE]
> It stops the server, waits for it to exit, and starts it again.
> The editor may warn that RCON is not confirmed for this block.
> The `say` lines already warn players through the console.
> A warning does not stop the graph from saving or running.

```flow
Interval: 360 minutes
[onComplete]
Command: say The server restarts in 1 minute.
[onComplete]
Delay: 50 s
[onComplete]
Command: say The server restarts in 10 seconds.
[onComplete]
Delay: 10 s
[onComplete]
* Command: Restart Server
```

## Switch it on

1. Select **Graph actions**, then **Save**.
2. Select **[off]** so it reads **[on]**.

> [!WARNING]
> **run** starts the graph at once: the warnings go out, and the server restarts a minute later.

> [!NOTE]
> A new graph starts off, and nothing fires until it is on.
