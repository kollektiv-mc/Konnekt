---
title: Remote Access
kind: settings
lead: Serves the dashboard to a browser and to Claude, on this computer or through a tunnel.
shelf: settings
order: 7
summary: Browser access, the tunnel and Claude.
facts:
  Topics: Remote access · Tunnel · Claude
related:
  - /docs/settings/notifications.html
  - /docs/first-server.html
  - /docs/faq.html
---

## Remote access {#remote-access}

Remote access serves Konnekt's dashboard to a web browser.
It is off each time Konnekt starts.

1. Set a password in **Password**.
2. Switch on **Remote access**.
3. Open the address next to **On this computer** in a browser, or press **Open ↗**.
4. Sign in with the password.
5. Check that the card **A browser is waiting to be approved** shows the code the browser shows.
6. Type a name for the device on the card, then press **Approve**.

```ui
# Settings · Remote Access
A browser is waiting to be approved
{Device name} | [*Approve*] | [Deny]
Remote access | [*On*]
On this computer | http://127.0.0.1:port | [Copy] | [*Open ↗*]
```

> [!NOTE]
> The switch stays off, with **Set a password first.** beside it, until a password exists.
> The same card opens as a dialog over the desktop, and a notification announces it.

- **Deny** refuses the browser.
  An unanswered request expires after five minutes.
- Once a device is approved, it signs in with the password alone.
- **On this computer** is the address Remote access listens on.
  It is `http://127.0.0.1` and a port Konnekt picks when Remote access starts.
  It serves plain HTTP and accepts connections from this computer only.
- Other computers reach it through a tunnel, covered in [Tunnel](#tunnel).

> [!WARNING]
> Remote access switches itself off after 30 minutes without use, unless Claude connectors hold it open.
> Closing Konnekt switches it off too, and a tunnel stops with it.

A remote browser cannot do these.

| It cannot | What it sees or needs instead |
| --- | --- |
| Change anything in this pane | The pane is desktop only. |
| Open a file picker or a folder | **About** shows the data folder as text. |
| Read the log, or change which server the desktop shows | Nothing. |
| Install an update | **Update Konnekt from the desktop.** stands in its place. |
| Keep **Appearance**, **Console** or **Notifications** changes past a reload | **Changes here apply to this browser until it reloads.** |
| Change a server's settings or files, app settings, installs or scheduled tasks without a yes | Each waits for **Allow once** on the desktop. The prompt reads *wants to make a change* and refuses itself after 60 seconds. |

## Tunnel {#tunnel}

**Reach it from anywhere** opens a Cloudflare quick tunnel to the dashboard.
It needs **Remote access** on first, and says **Switch remote access on first.** until then.

```ui
# Settings · Remote Access
Reach it from anywhere | [*On*]
{Hostname} | {Port} | {Tunnel token} | [Save]
```

> [!WARNING]
> Cloudflare sits between the browser and Konnekt and can read the traffic, your password included.

- Konnekt runs `cloudflared`, Cloudflare's tunnel program, with `tunnel --no-autoupdate --url http://127.0.0.1:port`.
- It downloads a fixed release from the `cloudflare/cloudflared` releases on GitHub when it has no verified copy.
  Konnekt checks the file's size and SHA-256 against values built into the app, before every run.
  The file lives in the `bin` folder of the data directory.
- Konnekt knows the download for Windows x86-64 and for Linux x86-64 and ARM64.
- The tunnel's address ends in `trycloudflare.com`, with a QR code for a phone camera.
  The address is new every time the tunnel starts.
- A device approved through it is forgotten when the tunnel closes, and is approved again on the next one.
- Switching **Remote access** off closes the tunnel, and so does its idle switch-off.

If the tunnel is not up within 45 seconds, the pane shows **The tunnel did not open.** and the last lines `cloudflared` printed.

### Your own address

**Your own address** is a named tunnel on your own Cloudflare account.
Its address stays the same across runs, and a device approved through it stays approved.
Claude connectors need it.

1. In the Cloudflare dashboard, create a tunnel.
2. Route a hostname you own to `http://127.0.0.1:port`, with a port from 1024 to 65535.
3. Copy the tunnel's token.
4. In Konnekt, fill in **Hostname**, **Port** and **Tunnel token**, then press **Save**.
5. Switch on **Remote access**, then **Reach it from anywhere**.

| Field | What it does | Default |
| --- | --- | --- |
| **Hostname** | The name you routed, such as `dash.example.net`, with at least two labels and no wildcard, scheme, port or path. | None |
| **Port** | The port your route points at, from 1024 to 65535. Remote access listens on it while the address is saved. | None |
| **Tunnel token** | The token from Cloudflare, kept in its own file and passed to `cloudflared` as a file path. | None |

- The token is never shown again, and a blank field on a later save keeps the stored one.
- **Change** and **Forget token** are locked while a tunnel runs.
- **Forget token** deletes the token, the hostname and the port, and removes the devices approved on that hostname.
  **Reach it from anywhere** then opens a quick tunnel again.
- A named tunnel counts as up once `cloudflared` registers a connection, and the address is `https://` and your hostname.

| Error | Do |
| --- | --- |
| the hostname is not a DNS name: use a name like dash.example.net | Enter a name such as `dash.example.net` in **Hostname**. |
| the tunnel token is not usable: paste the whole token, without spaces or line breaks | Paste the whole token again. |
| remote access is not listening on the named tunnel's port: it listens on *address* and the tunnel expects port *port*; switch remote access off and on | Switch **Remote access** off and on, and the listener moves to the saved port. |

## Claude {#claude}

```ui
# Settings · Remote Access
Claude on this computer | [*On*]
Listening on 127.0.0.1:port.
Claude Code | {claude mcp add …} | [Copy]
Claude Desktop config | {mcpServers entry} | [Copy]
Claude connectors | [Off]
```

Claude on this computer lets Claude Code and Claude Desktop on this computer use Konnekt's tools.
It is off by default, and it works without Remote access.

1. Switch on **Claude on this computer**.
2. For Claude Code, copy the line beside **Claude Code** and run it in a terminal.
3. For Claude Desktop, copy the **Claude Desktop config** entry and merge it into the `mcpServers` object of Claude Desktop's config file.

> [!NOTE]
> Konnekt opens a second listener on `127.0.0.1`, guarded by a secret it makes at every start.
> Claude starts `konnekt mcp`, a small bridge program, which forwards each call to that listener.
> The bridge lists the tools even when Konnekt is closed.

- The Claude Code line is `claude mcp add --transport stdio konnekt -- path mcp`.
- The entry is a `konnekt` server whose `command` is that path and whose `args` is `["mcp"]`.
  The path is the Konnekt executable that is running.
- While it listens, the pane reads **Listening on** an address, and **Register Konnekt once; Claude finds it again after a restart.**
- If it reads **Not listening.**, switch it off and on again, or check `konnekt.log`.
- A call while Konnekt is closed fails with **Konnekt is not running, or "Allow Claude on this computer" is off in its Settings.**

### What Claude can do

| Group | Tools |
| --- | --- |
| See | `list_servers`, `server_status`, `server_summary`, `players`, `stats_history`, `console_tail`, `server_log`, `last_stop`, `backups`, `worlds`, `schedules`, `schedule_next_runs`, `config_files`, `config_file` and `mods` |
| Operate | `start_server`, `stop_server`, `restart_server`, `kick_player`, `ban_player`, `pardon_player`, `create_backup` and `run_schedule` |
| Console | `send_command`: every call waits for you to press **Allow once**, and is refused if you do not |

- No tool force stops a server, restores or deletes a backup, changes a world or removes a mod.
  No tool edits a server's settings or files either.
- Console lines, player names, ban reasons and world names reach Claude marked as text that players wrote.

### Claude connectors

Claude connectors let claude.ai, Claude Desktop and Claude Code reach the same tools through the internet.
They are off by default.
The switch stays off until a password is set, with **Set the password below first.** beside it.
It then waits for **Your own address**, with **Set up your own address under Tunnel first.** beside it.
A quick tunnel is not enough, because its address changes.

1. Save **Your own address**.
2. Switch on **Remote access**, then **Reach it from anywhere**.
3. Switch on **Claude connectors**.
4. In claude.ai or Claude Desktop, add a connector and paste the connector URL.
   In Claude Code, run the line beside **Claude Code**.

- The connector URL is `https://`, your hostname and `/mcp`.
  It answers only while Remote access and the tunnel are on.
- The Claude Code line is `claude mcp add --transport http konnekt url`.
- While the switch is on and an own address is saved, the 30-minute idle switch-off is held back.
  The title bar then adds **Claude** to its label.

### Signing in a connector

1. Claude opens a Konnekt page called **Connect** and the client's name.
2. Tick the permissions.
3. Type the Remote Access password and press **Allow**.
4. Press **Allow** on the dialog on the desktop, which reads *wants to connect to Konnekt*.

> [!NOTE]
> **See your servers, players, console and schedules** is ticked, and **Start, stop and restart servers, run commands and manage players** is not.
> The page waits for the desktop and checks again every two seconds.
> It expires after five minutes, and a connector has no device code to type.

- A connector that holds only the first permission signs in again when it needs the second.
  Both permissions are offered at every sign-in, whatever the client asked for, so a reconnected client can add the second.
- Konnekt accepts sign-ins from Claude's own clients only.

**Connected clients** lists each one with its name and the host it was sent back to.
Each reads **Sees and operates servers** or **Sees servers, players, console and schedules.**
It also shows when the client connected and **Last used**, or **Not used yet.**
Until one signs in, the list reads **None yet.**

- **Revoke** ends one client's access at its next call.
- **Revoke all** appears when two or more are connected, and each signs in again from scratch.
- Konnekt holds at most 16 connectors.
  A 17th sign-in is refused on the sign-in page until one is revoked.
- A connector ends 90 days after you approved it, or 30 days after its last use.
- Changing the password ends every connector.

## Password {#password}

```ui
# Settings · Remote Access
Password | A password is set.
{New password} | [*Change password*]
```

- The password is 12 to 256 characters.
  Konnekt keeps only an argon2id hash of it.
- Changing it signs every device out, and ends every Claude connector.
  Devices stay approved and sign in again with the new password.
- A browser that types five wrong passwords in a row must wait.
  The wait starts at 5 seconds, doubles with each miss and tops out at 15 minutes.
- A device that is already approved has its own count.
  An hour without a miss clears it.

## Approved devices {#approved-devices}

```ui
# Settings · Remote Access
Approved devices
my-phone | signed in | [Remove]
[Sign out everywhere]
```

- A **signed in** tag marks a device with a live session.
- **Remove** forgets the device and ends its sessions, so its next sign-in needs approval again.
- **Sign out everywhere** ends every session, and devices stay approved.
- A session ends after an hour without use, or 12 hours after sign-in.
- A browser remembers its approval for a year.
- A device name is 1 to 40 printable characters, and no two devices share one.
- At most 16 devices can be approved.

| Error | Do |
| --- | --- |
| The request was declined or has expired. Sign in again. | Sign in again from the browser. |
| the device name must be 1 to 40 printable characters | Type a shorter name. |
| another device already has that name | Pick a name no other device has. |
| at most 16 devices can be approved; remove one first | Press **Remove** on one you no longer use. |
| that request has expired or was already answered | Sign in again from the browser. |
