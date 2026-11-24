---
title: Restart after a crash
kind: guide
lead: Start the server again each time it crashes.
shelf: tutorials
order: 2
summary: Start the server again when it dies.
facts:
  Duration: ~3 min
  Requirements: A server · An open Konnekt
  Topics: Scheduler
related:
  - /docs/blocks/trigger-server.html
  - /docs/blocks/action-command.html
  - /docs/graphs.html
  - /docs/timed-restart.html
---

## Before you start

- [ ] Konnekt left open
      Graphs run only while Konnekt is open.
- [ ] The scheduler editor
      Maximize the Scheduler tile to open it.

## What you build {#what-you-build}

Two blocks that start the server again after a crash.

```flow
Server: Crashed
[onComplete]
Command: Restart Server
```

## Add the trigger

1. Open the editor and select **Open blocks**.
2. Under **trigger**, click [Server](/docs/blocks/trigger-server.html).
3. Set **Type** to **Crashed**.
4. Set **Cooldown (seconds)** to `300`.

> [!WARNING]
> A crash inside the cooldown does not restart the server.
> That keeps a server that crashes on boot from restarting in a loop.

> [!NOTE]
> **Crashed** does not fire when you press Stop, which counts as **Stopped**.
> What counts as a crash is on the [Server block page](/docs/blocks/trigger-server.html).

```flow
* Server: Crashed
```

## Add the restart

1. Add [Command](/docs/blocks/action-command.html).
2. Set **Command** to **Restart Server**.
3. Drag from **onComplete** on **Server** to **trigger** on **Command**.

> [!NOTE]
> On a stopped server, **Restart Server** only starts it, which is the state after a crash.

```flow
Server: Crashed
[onComplete]
* Command: Restart Server
```

## Switch it on

1. Select **Graph actions**, then **Save**.
2. Select **[off]** so it reads **[on]**.

> [!WARNING]
> **run** restarts the server at once, crash or not.

> [!NOTE]
> A new graph starts off, and nothing fires until it is on.
