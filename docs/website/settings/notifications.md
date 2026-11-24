---
title: Notifications
kind: settings
lead: Which events raise an operating system notification, and which raise an in-app bubble.
shelf: settings
order: 4
summary: Desktop alerts and in-app bubbles.
facts:
  Topics: Notifications
related:
  - /docs/settings/general.html
---

## Desktop {#desktop}

```ui
# Settings · Notifications
Desktop
Warnings and info | [Off]
Errors | [Off]
Server crash | [Off]
Update available | [Off]
Player join/leave | [Off]
In-app bubbles
Warnings and info | [On]
Errors | [On]
Server crash | [On]
Update available | [On]
```

The operating system raises these.

| Setting | What it does | Default |
| --- | --- | --- |
| **Warnings and info** | Notifies on a server start, a finished backup, restore or install, a loader update, low TPS, or auto-save staying off. | Off |
| **Errors** | Notifies when a backup, restore, server install, loader update or scheduler run fails. | Off |
| **Server crash** | Notifies when a server stops unexpectedly. | Off |
| **Update available** | Notifies when the startup check finds a newer Konnekt version, set in [Updates](/docs/settings/general.html#updates). | Off |
| **Player join/leave** | Notifies when a player joins or leaves a server. | Off |

- The first one you switch on asks the system for permission to show notifications.
- The Notifications tile logs every event, whatever these are set to.
- A **Notify** block set to deliver to the desktop ignores them.
- A device waiting for remote access approval always notifies.

## In-app bubbles {#in-app-bubbles}

A bubble sits in the corner of the window until dismissed, and holds the full text.

| Setting | What it does | Default |
| --- | --- | --- |
| **Warnings and info** | Shows scheduler graph warnings, **Notify** block messages of kind **Info** or **Warning**, low TPS, and auto-save staying off. | On |
| **Errors** | Shows failed scheduler runs, backups, restores, installs and loader updates, scheduler errors, and **Notify** block errors. | On |
| **Server crash** | Shows a bubble when a server stops unexpectedly. | On |
| **Update available** | Shows a bubble when the startup check finds a newer Konnekt version. | On |
