---
title: What ends up in the bucket
kind: reference
lead: The keys Konnekt writes under a destination's prefix for uploads and snapshots, and when it deletes them.
shelf: settings
order: 6
summary: Every key Konnekt writes.
facts:
  Topics: Destinations · Distant Horizons
related:
  - /docs/settings/destinations.html
  - /docs/dh-publish.html
  - /docs/blocks/action-upload.html
  - /docs/blocks/action-dhPublish.html
---

## Key prefix {#key-prefix}

Every key starts with the destination's **Prefix**, then the block's **Key prefix**.
`<prefix>` stands for both.
With both blank, keys start at the bucket's root.

## Upload to Bucket {#upload-to-bucket}

| Key | Holds |
| --- | --- |
| `<prefix>/<path inside Source>` | One object per file, with folders kept as key segments. |
| `<prefix>/<file name>` | The object for a **Source** that is a single file. |

The block deletes nothing.
An object that exists at the same size is skipped, and any other is replaced.

## Publish DH Snapshot {#publish-dh-snapshot}

```tree
<prefix>/
  latest.json  # points at the newest snapshot
  snapshots/
    20261012T040000Z/  # one snapshot
      index.json
      index.html  # with Download page on
      myserver@minecraft@@overworld/  # with Download page on
        DistantHorizons.sqlite
  parts/
    <sha256>  # a slice of a database
```

| Key | Holds | Replaced or deleted |
| --- | --- | --- |
| `<prefix>/latest.json` | A pointer to the newest snapshot's `index.json`: its format, `createdAt` and the path. | Rewritten by each publish, as its last write. |
| `<prefix>/snapshots/<stamp>/index.json` | The snapshot: Distant Horizons version, server folder, and for each level its folder, size, SHA-256 and parts. | Deleted with its snapshot. |
| `<prefix>/snapshots/<stamp>/index.html` | With **Download page** on: the download page, listing each level's file with its size and the folder to put it in. | Deleted with its snapshot. |
| `<prefix>/snapshots/<stamp>/<level folder>/DistantHorizons.sqlite` | With **Download page** on: one level's whole database, built inside the bucket from its parts. | Deleted with its snapshot. |
| `<prefix>/parts/<sha256>` | A slice of a database, named by its SHA-256 and up to 8 MiB, shared by every snapshot that uses it. | Deleted when no kept snapshot lists it. |

- `<stamp>` is the snapshot's UTC time, such as `20261012T040000Z`.
- `<level folder>` is `<levelKeyPrefix>@<namespace>@@<path>`, such as `myserver@minecraft@@overworld`.

## Private link {#private-link}

```tree
<prefix>/
  <token>/  # 26 random lowercase letters and digits
    latest.json
    snapshots/
      20261012T040000Z/
  parts/  # stay where they are
```

| Key | Holds |
| --- | --- |
| `<prefix>/<token>/latest.json` | The pointer, as in the public layout. |
| `<prefix>/<token>/snapshots/<stamp>/…` | The same snapshot files as in the public layout. |
| `<prefix>/parts/<sha256>` | The parts, which stay where they are. |

- `<token>` is 26 random lowercase letters and digits.
- The destination's [Snapshot link](/docs/settings/destinations.html#snapshot-link) row switches between the two layouts.

## Deletions {#deletions}

| When | Deletes |
| --- | --- |
| A publish finishes | Snapshots beyond the newest **Snapshots to keep**, except the one `latest.json` points at. Then every part no kept snapshot lists. |
| The next publish after a cut-off one | A folder without `index.json`, once it is older than the oldest snapshot kept. |
| The link switches or rotates | The old address's `latest.json` first, then its whole `snapshots/` folder. Only the snapshot `latest.json` points at moves to the new address. |
| A destination is deleted in Settings | Nothing in the bucket. |

A cleanup only touches folders named like a stamp and parts named like a SHA-256.
If it cannot read what it needs, it deletes nothing, and the publish reports a warning.
The next publish cleans up again.
