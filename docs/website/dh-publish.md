---
title: Publish Distant Horizons LODs
kind: guide
lead: Publish the server's Distant Horizons data to a bucket as a snapshot others can download.
shelf: tutorials
order: 5
summary: Share a world's LODs from a bucket.
facts:
  Duration: ~20 min
  Requirements: A Distant Horizons server · A destination
  Topics: Distant Horizons · Destinations · Scheduler
related:
  - /docs/r2-bucket.html
  - /docs/bucket-layout.html
  - /docs/settings/destinations.html
  - /docs/blocks/action-dhSnapshot.html
---

## Before you start

- [ ] Distant Horizons on the server
      The jar is in `mods/`, and the server has started with it once.
- [ ] Generated Distant Horizons data
      At least one dimension of the world holds a `DistantHorizons.sqlite`.
- [ ] `serverKey` and `levelKeyPrefix` set
      Set both in `config/DistantHorizons.toml` to letters, digits, `_` and `-`.
      They name the folders players put the files in.
- [ ] A way to warn players
      Turn on `enable-rcon` in `server.properties`, or start the server from Konnekt.
- [ ] A destination
      A saved bucket, such as the one from [Save a Cloudflare R2 bucket](/docs/r2-bucket.html).

## What you build {#what-you-build}

Three blocks that publish a fresh snapshot every Sunday at 04:00.
Players download it from one link.

```flow
Cron Schedule: 0 4 * * 0
[onComplete]
DH Snapshot: stops, copies, starts
[onComplete · Staged folder]
Publish DH Snapshot: uploads to the bucket
```

## Add the trigger

1. Maximize the Scheduler tile to open the [scheduler editor](/docs/scheduler-editor.html).
2. In the graph picker, select **New graph**.
3. Select **Open blocks** at the top left of the canvas.
4. Under **trigger**, click **Cron Schedule**.
5. Set **Cron expression** to `0 4 * * 0`.

> [!NOTE]
> That fires every Sunday at 04:00 on this computer's clock.

```flow
* Cron Schedule: 0 4 * * 0
```

## Add DH Snapshot

1. Under **action**, open the **Distant Horizons** group and click **DH Snapshot**.
2. Set **Destination of the last snapshot** to your destination.
3. Drag from **onComplete** on **Cron Schedule** to **trigger** on **DH Snapshot**.

> [!WARNING]
> **DH Snapshot** stops the server for the copy.
> Pick an hour with few players.

> [!NOTE]
> With a destination set, the block uploads only the parts the bucket lacks.
> Use the same **Key prefix** here and in the next step, or leave both blank, so it finds the last snapshot.
> The other fields are on the [DH Snapshot](/docs/blocks/action-dhSnapshot.html) page.

```flow
Cron Schedule: 0 4 * * 0
[onComplete]
* DH Snapshot: your destination
```

## Add Publish DH Snapshot

1. In the same group, click **Publish DH Snapshot**.
2. Set **Destination** to the same destination.
3. Drag from **onComplete** on **DH Snapshot** to **trigger** on **Publish DH Snapshot**.
4. Drag from **Staged folder** on **DH Snapshot** to **Staged folder** on **Publish DH Snapshot**.

> [!NOTE]
> **Snapshots to keep** is `3` unless you change it.
> The other fields are on the [Publish DH Snapshot](/docs/blocks/action-dhPublish.html) page.

```flow
Cron Schedule: 0 4 * * 0
[onComplete]
DH Snapshot: your destination
[onComplete · Staged folder]
* Publish DH Snapshot: same destination
```

## Run it

1. Open **Graph actions** and select **Save**.
2. Select **run**.
3. Follow the progress in the server's console.
4. Select **[on]** so the trigger can fire.

> [!WARNING]
> **run** starts at once: players are warned, and the server stops 5 minutes later.

> [!NOTE]
> The first run uploads all of the data, so it takes the longest.
> Later runs send only the parts that changed.

```timeline
-5 min: Players read the first warning
-1 min: Second warning
-10 s: Last warning
* 0: The server stops and the data is copied
Copied: The server starts again
After: The snapshot uploads to the bucket
```

## Copy the link

1. Open Settings, then **Destinations**.
2. On the destination's **Snapshot link** row, select **Copy link**.
3. Send the link to the people who download the snapshot.

```ui
# Settings · Destinations
my-bucket | [Edit]
Snapshot link | Public | [*Copy link*]
```

## Choose public or private

- A new destination publishes to a fixed address under its prefix.
- A private link puts the snapshot behind a random token instead.
- Switch before the first publish and there is nothing to move.

> [!TIP]
> The switch and **Rotate link** are on [Snapshot link](/docs/settings/destinations.html#snapshot-link).

## When it refuses

| Error | Do |
| --- | --- |
| no Distant Horizons jar found in *folder*: the snapshot reads the version from it | Put the Distant Horizons jar in `mods/`. |
| index.json in *folder* was staged for a different layout (partsBase *value*, expected *value*): run the snapshot again | Run **DH Snapshot** again after switching a link between public and private. |
