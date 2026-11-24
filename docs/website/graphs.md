---
title: How a graph runs
kind: concept
lead: A graph is a set of wired blocks that a trigger starts and that then run one at a time.
shelf: scheduler
order: 1
summary: Triggers, order, data and failures.
facts:
  Duration: ~3 min
  Topics: Scheduler
related:
  - /docs/scheduler-editor.html
  - /docs/blocks/
  - /docs/nightly-backup.html
  - /docs/crash-restart.html
---

## What starts a run

- A graph belongs to the server it was built on.
  A server can have any number of graphs.
- A graph fires only while it is switched on.
  A new graph starts off, and **run** works on a graph that is off.
- Time triggers check the clock once a minute, whether or not the server is running.
- Event triggers fire when their own server reports the event.
  They wait out their **Cooldown (seconds)** between firings.

> [!WARNING]
> Graphs run only while Konnekt is open.
> Closing Konnekt stops the scheduler, and stops a running server too.
> A time that passes while it is closed is not made up.

```flow
* Cron Schedule: 0 4 * * *
[onComplete]
Create Backup: Full server
```

## Control and data

- **Control wires** set the order.
  Each block leaves by one control port, such as **onComplete** or **onTrue**, and only the blocks wired to it run next.
- Blocks wired to the same port run one after another, in an order not to rely on.
  Chain them with a wire when the order matters.
- A block that no control wire reaches never runs.
- **Data wires** carry values.
  A wired value replaces the block's own field.
  A wire that has no value yet leaves the field in use.
- Blocks with no control ports, such as **Read Attribute**, **Constant** and **Math**, run when a block that needs their value runs.
  They run once per run, and every block wired to them gets that value.
- The outputs of other blocks, such as the **Backup filename** of **Create Backup**, exist once that block has run.
  A block wired to one that has not run yet reads nothing.

```flow
Cron Schedule: 0 4 * * *
[onComplete]
Condition: A == 0
<- Read Attribute: players.count
[onTrue]
Create Backup: Full server
```

## Failures and limits

- A block that fails leaves by **onFailed**, and the blocks wired there run.
  With nothing wired there, that branch ends and the other branches carry on.
- The run is marked failed either way, with the reason of the first failure.
  It raises a **Run failed** bubble and adds it to Notifications.
- A graph runs once at a time.
  A trigger that fires during a run starts nothing, and is not queued.
- Different graphs run at the same time.

| Limit | Value |
| --- | --- |
| One block | 60 s, longer for the upload and Distant Horizons blocks |
| One run | 30 minutes, or longer when its blocks have longer limits |
| Block executions in a run | 500, which ends a loop |

```flow
Command: Restart Server
-> [onComplete] Notify: Back up
-> [onFailed] Notify: Restart failed
```
