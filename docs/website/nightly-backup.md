---
title: Back up every night when empty
kind: guide
lead: Back up the server at 04:00, but only on nights when no player is online.
shelf: tutorials
order: 1
summary: A cron trigger, a player check, a backup.
facts:
  Duration: ~5 min
  Requirements: A server · An open Konnekt
  Topics: Scheduler · Backups
related:
  - /docs/blocks/action-backup.html
  - /docs/blocks/control-condition.html
  - /docs/blocks/data-serverAttribute.html
  - /docs/cron.html
---

## Before you start

- [ ] Konnekt left open overnight
      Graphs run only while Konnekt is open.
- [ ] The scheduler editor
      Maximize the Scheduler tile to open it.

## What you build {#what-you-build}

Three blocks and one data block that back up the server at 04:00 on nights with nobody online.

```flow
Cron Schedule: 0 4 * * *
[onComplete]
Condition: A == 0
<- Read Attribute: players.count
[onTrue]
Create Backup: Full server
```

## Add the trigger

1. Open the editor and select **Open blocks**.
2. Under **trigger**, click **Cron Schedule**.
3. Set **Cron expression** to `0 4 * * *`.

> [!NOTE]
> That fires at 04:00 every day by this computer's clock.
> Change the second number to change the hour.
> The other forms are on the [cron page](/docs/cron.html).

```flow
* Cron Schedule: 0 4 * * *
```

## Check that nobody is online {#check-for-players}

1. Add [Condition](/docs/blocks/control-condition.html) and [Read Attribute](/docs/blocks/data-serverAttribute.html).
2. On **Read Attribute**, set **Attribute** to `players.count`.
3. On **Condition**, set **Operator** to `==` and **B** to `0`.
4. Drag from **onComplete** on **Cron Schedule** to **trigger** on **Condition**.
5. Drag from **Value** on **Read Attribute** to **A** on **Condition**.

> [!NOTE]
> **Read Attribute** has no control ports.
> It reads the player count when **Condition** runs.
> **Condition** leaves by **onTrue** when the count is 0, and by **onFalse** otherwise.
> Nothing is wired to **onFalse**, so a night with players online ends the run with no backup.

```flow
Cron Schedule: 0 4 * * *
[onComplete]
* Condition: A == 0
<- * Read Attribute: players.count
```

## Add the backup

1. Add [Create Backup](/docs/blocks/action-backup.html).
2. Leave **Target** at **Full server**, or pick **Active world** to zip only the world.
3. Drag from **onTrue** on **Condition** to **trigger** on **Create Backup**.

```flow
Cron Schedule: 0 4 * * *
[onComplete]
Condition: A == 0
<- Read Attribute: players.count
[onTrue]
* Create Backup: Full server
```

## Switch it on

1. Select **Graph actions**, then **Save**.
2. Select **run** to test it.
3. Select **[off]** so it reads **[on]**.

> [!WARNING]
> **run** starts the graph at once, so with nobody online it makes a real backup.

> [!NOTE]
> A new graph starts off, and nothing fires until it is on.
