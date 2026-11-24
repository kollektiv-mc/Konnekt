---
title: Console
kind: settings
lead: How many console lines Konnekt keeps, and whether each one shows its time.
shelf: settings
order: 3
summary: Timestamps and buffer size.
facts:
  Topics: Console
related:
  - /docs/settings/appearance.html#advanced
  - /docs/first-server.html
---

## Console log {#console-log}

```ui
# Settings · Console
Show timestamps | [Off]
Buffer size | {1000} | lines
```

| Setting | What it does | Default |
| --- | --- | --- |
| **Show timestamps** | Prefixes each console line with the time Konnekt received it, as hours, minutes and seconds. | Off |
| **Buffer size** | Sets how many console lines Konnekt keeps in memory, at least 100, before the oldest drop off. | 1000 lines |

- Timestamps also show on the notes Konnekt adds to the log itself, such as backup progress.
- The toggle applies to lines already on screen.
- Switching to another server refills the console from the last 2000 lines Konnekt kept for that server.
  A larger buffer grows only from live output after that.
