---
title: Save a Cloudflare R2 bucket
kind: guide
lead: Connect a Cloudflare R2 bucket to Konnekt so scheduler blocks can upload to it.
shelf: tutorials
order: 4
summary: A destination for uploads and snapshots.
facts:
  Duration: ~10 min
  Requirements: A Cloudflare account with R2
  Topics: Destinations
related:
  - /docs/settings/destinations.html
  - /docs/dh-publish.html
  - /docs/blocks/action-upload.html
  - /docs/bucket-layout.html
---

## Before you start

- [ ] A Cloudflare account with R2
      Cloudflare issues an R2 token only after R2 is purchased on the account.
- [ ] A public address for the bucket
      Only snapshot links need it.
      Step 04 adds it.

## Create the bucket

1. In the Cloudflare dashboard, open **R2 object storage**.
2. Select **Create bucket**, name it, then select **Create bucket** again.
3. Open the bucket's **Settings** tab and find **S3 API**.

> [!NOTE]
> The endpoint is `https://<account id>.r2.cloudflarestorage.com`.
> A bucket in a jurisdiction uses a host such as `<account id>.eu.r2.cloudflarestorage.com`.
> Konnekt takes the host only, so leave off anything after it.

## Create an API token

1. On the R2 overview, under **Account Details**, select **Manage** next to **API Tokens**.
2. Select **Create Account API token** or **Create User API token**.
3. Under **Permissions**, choose **Object Read and Write**.
4. Scope the token to the bucket from step 01.
5. Create the token, then copy the **Access Key ID** and the **Secret Access Key**.

> [!WARNING]
> A token that only reads cannot upload.
> Konnekt lists, reads, writes and deletes objects in the bucket.

## Add the destination

1. Open Settings, then **Destinations**.
2. Select **Add destination**.
3. Fill in the fields.
4. Select **Test**, then **Save**.

| Field | Value |
| --- | --- |
| **Name** | Any name: scheduler blocks pick the bucket by it. |
| **Endpoint** | The host from step 01. |
| **Region** | `auto` |
| **Bucket** | The bucket's name. |
| **Prefix** | A folder for Konnekt's objects, or blank. |
| **Public base URL** | Blank until step 04. |
| **Access key ID** | The **Access Key ID** from step 02. |
| **Secret access key** | The **Secret Access Key** from step 02. |

> [!NOTE]
> **Test** writes nothing to the bucket.
> Each field is described on [Destinations](/docs/settings/destinations.html#fields).

```ui
# Settings · Destinations
No destination yet.
[*Add destination*]
```

## Add a public address

1. In the bucket's Settings, add one of the addresses below.
2. In Konnekt's Settings, **Destinations**, select **Edit** on the destination.
3. Enter the address in **Public base URL**, such as `https://files.example.com`.
4. Select **Save**.

| Address | Steps in the bucket's Settings |
| --- | --- |
| Custom domain | Under **Custom Domains**, select **Add**, enter a domain on a zone in the same account, select **Continue**, then **Connect Domain**. Wait for **Active**. |
| `r2.dev` | Under **Public Development URL**, select **Enable**, type `allow`, then select **Allow**. Cloudflare rate-limits it and intends it for non-production use. |

> [!NOTE]
> A snapshot link is the **Public base URL** followed by the object's key.
> Without one, the link points at the bucket's own S3 address, which opens only for a bucket that serves objects publicly.
> Only snapshot links use it, and **Upload to Bucket** does not.

```ui
# Settings · Destinations
my-bucket | [*Edit*]
{*https://files.example.com*} | [Save]
```

## When it refuses

| Error | Do |
| --- | --- |
| the bucket refused the upload (*status* *code*): check the destination's access key and secret, and that the key may write to the bucket | Create the token again with **Object Read and Write** on this bucket. **Test** writes nothing, so it does not show whether a token can write. |
| public base URL must be an http(s) address | Start **Public base URL** with `https://`. |
