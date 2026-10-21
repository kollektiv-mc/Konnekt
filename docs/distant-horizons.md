# Publishing Distant Horizons data

Konnekt can copy a server's [Distant Horizons](https://modrinth.com/mod/distanthorizons)
LOD data on a schedule, upload it to a bucket, and give players a link to
download it. A new player then starts with the whole world rendered in the
distance instead of waiting for the server to stream it. This page is the setup:
what the server needs, the bucket, the scheduler graph and its values, and what
players do with the link.

Two scheduler blocks do the work. **DH Snapshot** warns the
players, stops the server, copies the LOD databases out, and starts it again.
**Publish DH Snapshot** uploads the copy to the bucket and writes the download
page. The server is only down for the copy, and only the parts of each database
that changed since the last run are copied and uploaded.

## Before you start

**The server runs Distant Horizons.** The mod's jar is in the server's `mods/`
folder, and the server has started with it at least once, so that
`config/DistantHorizons.toml` exists. Konnekt reads the DH version from the jar
and three settings from that file.

**Two settings in `config/DistantHorizons.toml`.** Both are empty by default and
the snapshot refuses to run until they are set. DH writes both keys into the file
with empty values, so search for them. Edit the file while the server is stopped:

| Setting | Value | Why |
| --- | --- | --- |
| `serverKey` | A name of your choosing, such as `"frangfurd"`. Letters, digits, `_` and `-` only. | Every player's client then stores this server's LODs under one folder, `<serverId>_<serverKey>`, whatever the server is called in their server list. The download goes in that folder. |
| `levelKeyPrefix` | A short name, same characters, such as `"frangfurd"`. | Names each dimension's folder on the client, `<levelKeyPrefix>@<dimension>`. Left empty, DH derives it from the seed, which Konnekt cannot reproduce. |

Leave `serverId` alone: DH generated it, and it is the first half of the client
folder. Setting `serverKey` moves players who have already joined to a new,
empty folder once; the snapshot then fills it. Players need to rejoin after a
change. DH's own comments on these settings are in its config source, under
`Server`.

**RCON, so players hear the warning.** Set `enable-rcon=true` and an
`rcon.password` in `server.properties`. The snapshot warns players in chat
before it stops the server. With RCON it sends the warning over RCON; without it,
it types the warning into the server's console, which only works for a server
Konnekt started itself. The graph editor shows a warning when RCON is not
confirmed for the server.

**Free disk space.** The snapshot stages its copy under Konnekt's data folder by
default (`%AppData%\konnekt` on Windows, `~/Library/Application Support/konnekt`
on macOS, `~/.config/konnekt` on Linux), and refuses to start when the volume has less free space than the
databases' total size plus 1 GiB. A first snapshot copies everything; later ones
copy only the changed parts.

**A bucket.** Cloudflare R2 is the tested path. Any S3-compatible store should
work; nothing has been run against one yet.

## 1. Create the bucket (Cloudflare R2)

1. In the Cloudflare dashboard, open **R2 Object Storage** and create a bucket.
2. Under **Account Details**, open **Manage API tokens** and create a token with
   **Object Read and Write** permission, scoped to that bucket. Copy the
   **Access Key ID** and the **Secret Access Key** now; the secret is shown once.
3. Note the S3 endpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, with
   your account ID from the dashboard. A bucket in a jurisdiction uses that
   jurisdiction's endpoint instead, such as `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`.
4. Make the bucket readable: in the bucket's **Settings**, under **Custom
   Domains**, add a domain on a zone in the same Cloudflare account, and wait
   for it to go **Active**. The `r2.dev` development address also works, but
   Cloudflare rate-limits it and calls it unfit for production, so use a custom
   domain for anything players download.

Cloudflare's own pages: [API tokens](https://developers.cloudflare.com/r2/api/tokens/),
[public buckets and custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/).

## 2. Save the bucket in Konnekt

Open **Settings** (the gear in the title bar), then **Destinations**, and add one:

| Field | Value |
| --- | --- |
| Name | What the graph will call it, such as `R2`. |
| Endpoint | The S3 endpoint from above, host only. |
| Region | `auto` for R2. |
| Bucket | The bucket's name. |
| Prefix | Optional. A folder every upload to this destination goes under, such as `dh`. |
| Public base URL | The custom domain the bucket is served from, such as `https://files.example.com`. Links in the download page and the published URL are built from it. Without one, links point at the bucket's own S3 address, which players cannot open. |
| Access key ID | From the token. |
| Secret access key | From the token. |

**Test** checks the credentials and the bucket, then **Save**. The secret is
written to an owner-only file on this computer and never shown again; the graph
refers to the destination by name, so an exported graph carries no credential.

## 3. Build the graph

Open the **Scheduler** tile, start a new graph, and add four blocks from the
palette (click or drag):

```
Cron Schedule  ->  DH Snapshot  ->  Publish DH Snapshot  ->  Notify
```

Wire them:

- Control: the trigger's `onComplete` to the snapshot's `trigger`, the
  snapshot's `onComplete` to the publish's `trigger`, the publish's
  `onComplete` to a Notify.
- Data: the snapshot's **Staged folder** output to the publish's **Staged
  folder** input. This is what tells the publish which copy to upload.
- Optional: the publish's **Snapshot URL** output to the Notify's **Message**
  input, so the notification carries the link. A second Notify on each block's
  `onFailed`, with kind **Error**, tells you when a run did not finish.

Then the values. Click a block to edit it.

**Cron Schedule**

| Field | Value |
| --- | --- |
| Cron expression | `0 4 * * 0` runs every Sunday at 04:00. Five fields: minute, hour, day of month, month, weekday, with `0` as Sunday. The time is this computer's local clock. |

Once a week is a reasonable default: each run stops the server for the copy,
and DH keeps returning players up to date in game on its own, so the snapshot
matters most to new players.

**DH Snapshot**

| Field | Value | Default |
| --- | --- | --- |
| Destination of the last snapshot | The same destination the publish uses. With it set, the block reads the bucket's `latest.json` to learn which parts are already uploaded and copies only the rest. Left at **None**, it compares against the index left in the staging folder, which is only as true as the last publish. | None |
| Key prefix | The same key prefix as the publish, or empty. | Empty |
| Staging folder | Leave empty: the copy goes to `dh-snapshots/<server id>/` under Konnekt's data folder. A folder of your own must be an absolute path outside the server's folder, or a server backup would carry a second copy of the LOD data. | Empty |
| Warn players this many seconds before | How long before the stop players are told. The message goes out at this lead time, again at one minute, and again at ten seconds. `0` stops with no warning. At most 1800. | `300` |
| Warning | What players read in chat. `{time}` becomes the time left, as "5 minutes" or "10 seconds". | `The server will stop in {time} for a world snapshot and be back shortly.` |

**Publish DH Snapshot**

| Field | Value | Default |
| --- | --- | --- |
| Destination | The saved bucket. Required. | |
| Key prefix | Optional. A folder under the destination's prefix, so one bucket can hold several servers: `survival`, `creative`. The published files sit under `<destination prefix>/<key prefix>/`. | Empty |
| Staged folder | Leave empty. The wired data edge fills it with the snapshot's folder, and empty means this server's own staging folder anyway. | Empty |
| Snapshots to keep | How many dated snapshots stay in the bucket after a publish. Older ones are deleted, along with the parts only they used. At least 1. | `3` |

Press **save**, then switch the graph **[on]**. **run** starts it once right
away, which is the way to take the first snapshot at a time of your choosing
rather than waiting for Sunday. While it runs, the toolbar says `running…`, the
snapshot's lines appear in the **Console** tile and the first warning reaches chat
at once. A run that fails before the snapshot starts, such as a destination that
no longer exists, says why in red beside **run** until you click it away.

## What a run does

1. **Checks, with the server still up.** DH's config and jar, the databases,
   free space, that a warning can reach players, and that the bucket's
   `latest.json` can be read (or is absent, which is a first snapshot). Any
   failure here stops the run before anyone is warned.
2. **Warnings** in chat at the lead time, one minute and ten seconds.
3. **Stop.** The server is asked to stop and given the stop grace period from
   Settings, General, to save the world.
4. **Copy.** Each dimension's `DistantHorizons.sqlite` is read once in 8 MiB
   parts. Parts already in the previous snapshot are skipped; the rest are
   written to the staging folder, named by their hash, with an `index.json`.
5. **Start.** The server starts again. This happens whether the copy succeeded
   or not, and even when the block runs out of time, so a bad run costs the
   snapshot and never the uptime. The block's console lines report the measured
   downtime, and the node shows it under its **Stops the server** badge.
   From the stop to this start nothing else can start the server: a schedule
   triggered by the server stopping, or **Start** in the app, is refused until
   the block has started it itself.
6. **Publish**, with the server running. Parts the bucket does not have are
   uploaded. The bucket then assembles each dimension's whole database from the
   parts by copying inside the bucket, so no database is uploaded twice. The
   index and the download page are written, and `latest.json` last, so a reader
   never sees a snapshot with files missing. A run cut off before that leaves the
   previous snapshot current, and the next run resumes: a part already in the
   bucket is never sent again.
7. **Prune.** Snapshots beyond **Snapshots to keep** are deleted, then the parts
   no kept snapshot uses. A failure here does not fail the run; it shows as a
   warning on the publish node and in the run's record.

The first publish sends every part: for a 20 GB world, that is hours on a home
connection. The publish block allows twelve hours. Later publishes send only
what changed.

## 4. Give players the link

Open **Settings**, **Destinations**, and press **Copy link** on the destination.
That is the link to `latest.json`, which a launcher reads. The same place in the
bucket also holds a download page for people:

```
https://files.example.com/<prefix>/latest.json
https://files.example.com/<prefix>/snapshots/<date>/index.html
```

The page lists each dimension's file with its size and date, a download link,
and the folder to put it in. For a player the steps are:

1. Close the game.
2. Download `DistantHorizons.sqlite` for each dimension.
3. Put each one in
   `Distant_Horizons_server_data/<serverId>_<serverKey>/<levelKeyPrefix>@minecraft@@overworld/`
   (and the matching folder for the other dimensions) inside the game folder,
   the one that holds `mods` and `saves`. The page prints the exact path.
4. Start the game and join. DH loads the file and keeps it up to date in game
   from there.

A player who has already explored the world does not need the download: DH
syncs what they have against the server when they join.

### Private link

By default anyone with the bucket's address can read the snapshot. The
**Private link** switch on the destination moves the published snapshot under
an address with a random 128-bit segment in it that nobody can guess:

```
https://files.example.com/<prefix>/<token>/latest.json
```

**Copy link** then gives out that address, and it is the only place the token
is shown. **Rotate link** moves the snapshot to a new address, and the old one
stops working for everyone at once. Switching the mode or rotating takes a few
minutes, because the published files are copied inside the bucket, and the next
scheduled publish lands under the new address on its own.

Two things to know. A private link is a shared secret, not access control:
anyone holding it can pass it on, and rotating is the only way to revoke it.
And R2's public buckets do not list their contents, which is what keeps the
parts private; another provider's might.

For real sign-in, put [Cloudflare Access in front of the bucket's custom domain](https://developers.cloudflare.com/r2/tutorials/cloudflare-access/).
Browsers then sign in, and the `r2.dev` address must be off or the bucket stays
public. Konnekt uploads through the S3 API, which Access does not sit in front
of, so nothing in Konnekt changes.

## Filling the map first

A snapshot carries only what DH has generated. A server whose players have
stayed near spawn has little to publish. DH's own pregeneration command fills a
radius before the first snapshot, and the **RCON Command** block, or the
console, can run it:

```
/dh pregen start minecraft:overworld 0 0 512
/dh pregen status
/dh pregen stop
```

The arguments are the dimension, the centre's x and z, and the radius in chunks
(at least 32). Pregeneration costs CPU for hours on a large radius, so run it
once, off-peak.

## Values at a glance

| Value | Where | Default or limit |
| --- | --- | --- |
| Warning lead time | Snapshot block | 300 s, at most 1800 s |
| Warning marks | Fixed | lead time, 1 minute, 10 seconds |
| Stop grace period | Settings, General | 5 to 600 s |
| Part size | Fixed | 8 MiB |
| Free space needed to stage | Fixed | databases' size + 1 GiB |
| Snapshot block time limit | Fixed | 3 hours; the server is restarted on reaching it |
| Publish block time limit | Fixed | 12 hours; `latest.json` is untouched on reaching it |
| Snapshots kept | Publish block | 3, at least 1 |
| Private link token | Fixed | 128 bits, 26 characters |

## What ends up in the bucket

For a launcher or a script that fetches the snapshot itself:

```
<prefix>/latest.json                                   pointer, written last
<prefix>/snapshots/<stamp>/index.json                  the snapshot
<prefix>/snapshots/<stamp>/index.html                  the download page
<prefix>/snapshots/<stamp>/<level folder>/DistantHorizons.sqlite
<prefix>/parts/<sha256>                                8 MiB parts, shared by every snapshot
```

With a private link, everything but `parts/` sits under `<prefix>/<token>/`
instead. `<stamp>` is the snapshot's UTC time, `20261012T040000Z`.

`latest.json`:

```json
{ "format": 1, "createdAt": "2026-10-12T04:00:00Z", "index": "snapshots/20261012T040000Z/index.json" }
```

`index.json`:

```json
{
  "format": 1,
  "createdAt": "2026-10-12T04:00:00Z",
  "partsBase": "../../parts/",
  "dhVersion": "2.3.4",
  "serverFolder": "1234567890_frangfurd",
  "levels": [
    {
      "folder": "frangfurd@minecraft@@overworld",
      "size": 21474836480,
      "sha256": "<hash of the whole file>",
      "parts": [{ "sha256": "<hash>", "size": 8388608 }]
    }
  ]
}
```

`index` and `partsBase` are relative to the file they appear in, never absolute.
A client puts each level at
`Distant_Horizons_server_data/<serverFolder>/<folder>/DistantHorizons.sqlite`,
can check the download against the level's `sha256`, and should refuse a
`dhVersion` newer than its own DH.

## When a run refuses

The block's error names what to fix. The common ones:

| Message says | Do |
| --- | --- |
| `config/DistantHorizons.toml was not found` | Start the server once with DH installed. |
| `serverKey is empty` or `levelKeyPrefix is empty` | Set them as above, with the server stopped. |
| `serverId is not set` | DH writes it on the first save of its config. Start the server once with DH. |
| `no Distant Horizons jar found in mods/` | DH runs as a mod; the snapshot reads the version from the jar. |
| `the server is not running` | The block warns, stops and restarts a running server. Start it first. |
| `neither RCON nor the server's console can carry the warning` | Enable RCON, or start the server from Konnekt, or set the lead time to 0 to stop without a warning. |
| `not enough free space to stage the snapshot` | Free space, or point the staging folder at another volume. |
| `cannot read the previous snapshot from "R2"` | The bucket answered with something other than the pointer or a clean 404. Check the destination with Test. Carrying on would re-upload everything, so the run stops instead. |
| `another Distant Horizons snapshot or publish is already running for this server` | A snapshot and a publish for the same server never overlap. Wait for the running one. |
| A warning on the publish node | The snapshot is published; the prune, or noting the prefix for Copy link, did not finish. The next publish retries. |
