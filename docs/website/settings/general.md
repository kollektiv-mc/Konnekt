---
title: General
kind: settings
lead: How servers start and stop, and when Konnekt checks for updates.
shelf: settings
order: 2
summary: Starting, stopping and updates.
facts:
  Topics: Start and stop · Updates
related:
  - /docs/settings/notifications.html
  - /docs/first-server.html
  - /docs/faq.html
---

## Server {#server}

```ui
# Settings · General
Auto-start active server | [Off]
Confirm before stopping | [Off]
Stop grace period | {60} | seconds
```

| Setting | What it does | Default |
| --- | --- | --- |
| **Auto-start active server** | Starts the active server when Konnekt launches. | Off |
| **Confirm before stopping** | Asks before the **Stop** and **Restart** buttons act. | Off |
| **Stop grace period** | Sets how long a stop waits for the server to exit before a force kill, from 5 to 600 seconds. | 60 s |

- The active server is the one picked in the sidebar's **Servers** list.
  Konnekt remembers it between launches.
- Auto-start does nothing when no server has been added.
- The grace period also applies to restarts and to stops from the scheduler.
- **Force stop** always asks for confirmation, whatever **Confirm before stopping** says.

A stop runs in this order.

```timeline
0: Konnekt sends stop to the server
Halfway: SIGTERM, where the platform has it
* End of the grace period: Force kill of the server and everything it started
```

> [!NOTE]
> A server that has already written a crash report waits at most 10 s.

## Updates {#updates}

```ui
# Settings · General
Check for updates on startup | [On]
Update channel | [Stable] | [Snapshot]
```

| Setting | What it does | Default |
| --- | --- | --- |
| **Check for updates on startup** | Checks once at each launch and alerts you when a newer build exists. | On |
| **Update channel** | Chooses whether Konnekt offers releases only (**Stable**) or snapshots too (**Snapshot**). | Stable |

- The check asks GitHub Releases and installs nothing.
  Install an update from Settings, **About**.
- The alert follows the **Update available** rows in [Notifications](/docs/settings/notifications.html).
- A build with `-dev` in its version, such as a plain source build, skips the check.
- **Stable** never contacts the snapshot release.
  **Snapshot** offers whichever is newer, the latest snapshot or the latest release.
- A snapshot is a build of the newest code, published as a pre-release.
  It is built nightly when the code has changed.

> [!WARNING]
> Snapshots are untested and can be broken.
> Back up your server directory before installing one.

A snapshot build follows the snapshot channel until you install a release.
Settings still shows the stored channel, and adds the line **This build is a snapshot, so it follows the snapshot channel until you install a release.**
After a release is installed, the stored channel applies again.
