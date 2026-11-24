---
title: Destinations
kind: settings
lead: Saved S3-compatible buckets that scheduler blocks upload to.
shelf: settings
order: 5
summary: Buckets for uploads and snapshots.
facts:
  Topics: Destinations · Backups · Distant Horizons
related:
  - /docs/settings/notifications.html
  - /docs/r2-bucket.html
  - /docs/dh-publish.html
  - /docs/bucket-layout.html
---

## Add a destination {#add}

1. Open Settings, then **Destinations**.
2. Select **Add destination**.
3. Fill in the [fields](#fields).
4. Select **Test** to check the credentials and the bucket.
5. Select **Save**.

```ui
# Settings · Destinations
No destination yet. | [*Add destination*]
{Name} | {Endpoint} | {Region}
{Bucket} | {Prefix} | {Public base URL}
{Access key ID} | {Secret access key}
[Save] | [*Test*] | [Cancel]
```

> [!NOTE]
> **Save** and **Test** stay disabled until **Name**, **Endpoint**, **Bucket**, **Access key ID** and a secret are filled in.
> **Test** writes nothing to the bucket.

- The **Upload to Bucket** and **Publish DH Snapshot** blocks pick a destination by name.
  A graph names the destination and never carries its credentials.
- The destination's settings are saved in `destinations.json` in the app's data folder.
- The secret access key is saved in a file of its own, in the `destination_secrets` folder beside it.
  That file is written with owner-only permissions, and the secret is never shown again.
- Deleting a destination removes its secret file too.

## Fields {#fields}

| Field | What it does | Default |
| --- | --- | --- |
| **Name** | Required: what a scheduler block calls this bucket. | None |
| **Endpoint** | Required: the provider's S3 address, host only, such as `https://<account>.r2.cloudflarestorage.com` for R2. | None |
| **Region** | The signing region, `auto` for R2 and the provider's own name elsewhere. | `auto` |
| **Bucket** | Required: the bucket's name, without a slash. | None |
| **Prefix** | A folder inside the bucket that uploads go under. | None |
| **Public base URL** | The `http` or `https` address the bucket is served from, such as a custom domain. | None |
| **Access key ID** | Required: the ID of the key pair the provider issued. | None |
| **Secret access key** | Required on a new destination; blank on a saved one keeps the stored secret. | None |

- Names are unique in any letter case.
- An endpoint without `https://` in front gets it added.
- A blank region is saved as `auto`.
- A prefix loses any slash at either end, and a block's own **Key prefix** goes after it.
- A published snapshot's links use the **Public base URL**, and the bucket's own address when there is none.

## Snapshot link {#snapshot-link}

Each saved destination has a **Snapshot link** row, for the Distant Horizons snapshot a **Publish DH Snapshot** block uploads.
The link is the address of the snapshot's `latest.json`, which is what you give to the people who download the snapshot.

```ui
# Settings · Destinations
my-bucket | [Edit]
Snapshot link | Private link | [*Copy link*] | [Rotate link]
```

| Control | What it does |
| --- | --- |
| **Copy link** | Puts the link on the clipboard. It is empty until a snapshot has been published to the destination. |
| Switch, **Public** or **Private link** | **Public** keeps the snapshot at a fixed address under the destination's prefix. A private link moves it into a folder named by a random token, so only someone given the link can find it. |
| **Rotate link** | Appears in private mode. Moves the latest snapshot under a new token and deletes the old address. |

- Switching the mode moves the latest snapshot, which takes a few minutes, and asks first.
- A publish and a link change cannot run together on one destination.
- The token is saved in a `.link` file beside the secret, and removed with the destination.

> [!WARNING]
> Once a snapshot is published, the address used before a switch or a rotation stops working.
> Everyone holding the old link loses access, and has to be sent the new one.

> [!NOTE]
> If the old files cannot all be deleted, the row says the previous link may still work.
> Switch the mode or rotate again to finish removing them.

## Errors {#errors}

| Error | Do |
| --- | --- |
| Wrong credentials: *host* refused the access key or secret (*status*). | Check **Access key ID** and **Secret access key** against the provider. |
| Bucket not found: *host* has no bucket named *name*. | Check **Bucket**, and that the key can see it. |
| Could not reach *host*. Check the endpoint and your connection. | Check **Endpoint** for typos, then your network. |
| *host* rejected the check (status *status code*). Check the region and endpoint. | Set **Region** to what the provider documents. |
| endpoint must be a host only, without a path or credentials | Remove everything after the host from **Endpoint**. |
| a destination named "*name*" already exists | Pick another **Name**. |
| nothing has been published to this destination yet, so there is no link to copy: run a Publish DH Snapshot block first | Run the block once, then select **Copy link** again. |
| a snapshot is being taken or published to this destination: change the link when it has finished | Wait for the run to end, then switch or rotate again. |
| destination "*name*" no longer exists; choose another in the Upload to Bucket block or add it in Settings | Add the destination again with the same name, or pick another in the block. |
