## What a run does {#run}

1. Use each wired **URL**, **Request body** or **Content-Type** in place of its field.
2. Send one request with a 30 s timeout, following up to 10 redirects.
3. Read the whole response body.
4. Leave by **onComplete** when the status is below 400.
5. Leave by **onFailed** on a status of 400 or above, and on a connection error.

- An empty **Request body** sends no body and no `Content-Type` header.
- An empty **Content-Type** sends `application/json`.
- **HTTP status** carries the status code whenever a response arrived, failed or not.
- **Response body** carries the body as text once the whole body has been read.

> [!WARNING]
> A body over 1 MiB fails the block and sets no **Response body**.

> [!NOTE]
> The block does not filter addresses, so a URL on the local network works.

```flow
Cron Schedule: 0 * * * *
[onComplete]
* HTTP Request: POST
-> [onComplete] Notify: Request sent
-> [onFailed] Notify: Request failed
<- Constant: https://example.com/hook
```

## Errors {#errors}

| Message says | Do |
| --- | --- |
| url is empty | Fill in **URL** or wire one in. |
| HTTP *status*: *response body* | The service answered 400 or above; check the request and what the service expects. |
| HTTP *status*: response body exceeds 1048576 bytes | Request something smaller; the block keeps 1 MiB at most. |
| HTTP *status*: read response: *reason* | The connection broke while the body was read; check the service and the network. |
| *Method* "*url*": *reason* | Check the address, that the service is reachable and that it answers within 30 s. |
