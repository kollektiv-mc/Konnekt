## What a run does {#run}

1. Resolve **Source** against the server folder, and refuse anything outside the folders the block may read.
2. List the files: a folder is walked in name order, and a link to a folder is not entered.
3. Refuse the whole upload, before sending anything, if one file is over 5 GiB.
4. Check each object in the bucket: one of the same size is skipped, anything else is sent.
5. Stop at the first failure and keep what was sent, so the next run resumes.

> [!WARNING]
> Only the size is compared.
> A file edited to the same length is not sent again.

- Each key is the destination's prefix, then **Key prefix**, then the file's path below **Source**.
- A single file is stored under its file name.
- A wired **Source** or **Key prefix** replaces its field.
- It leaves by **onComplete** when every file is sent or skipped, and by **onFailed** on any error.
- **Objects uploaded**, **Objects skipped** and **Bytes sent** are set after a successful run.

> [!NOTE]
> Progress and the result appear in the server's console.
> The block can run for up to 12 hours.

```flow
Cron Schedule: 0 5 * * *
[onComplete]
Create Backup: Full server
[onComplete]
* Upload to Bucket: your destination
-> [onComplete] Notify: Backup uploaded
-> [onFailed] Notify: Upload failed
```

## Errors {#errors}

| Message says | Do |
| --- | --- |
| destination validation failed: Upload to Bucket (*node*): the destination "*name*" does not exist. It was deleted or renamed in Settings, or this graph came from another install. | Pick a destination that exists, or add it in Settings. |
| destination "*name*": *reason* | Correct the destination in Settings. |
| key prefix "*prefix*" must not contain "*segment*" | Remove the `.` or `..` segment from the prefix. |
| source *path* does not exist | Check the path of the source. |
| source *path* is outside the folders a graph may upload from (the server's folder and its backups) | Choose a source in the server folder, its backups folder or its DH staging folder. |
| *file* is a link that is outside the folders a graph may upload from (the server's folder and its backups) | Remove the link, or point it inside those folders. |
| source *path* holds no files to upload | Choose a source that holds at least one file. |
| *key* is *size*, over the 5 GiB single upload limit, so nothing was uploaded; split it or leave it out of the folder: file is over the 5 GiB single upload limit | Split the file or move it out of the folder. |
| object *n* of *total*: *reason* | Run it again; objects already sent are skipped. |
| timed out after 43200s: *reason* | Run it again; objects already sent are skipped. |
