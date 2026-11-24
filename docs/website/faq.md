---
title: FAQ
kind: reference
lead: Short answers about Konnekt, servers and updates.
shelf: new-here
order: 4
summary: Common questions, short answers.
facts:
  Topics: Licence · Privacy · Servers · Updates
related:
  - /docs/install.html
  - /docs/first-server.html
  - /docs/requirements.html
---

## Konnekt

### Is it free?

Yes, under the [MIT licence](https://github.com/kollektiv-mc/Konnekt/blob/main/LICENSE): keep the copyright notice, and the rest is yours.
No accounts, no tiers, no subscriptions.

### Does it phone home?

No telemetry, analytics or crash reporting.
On its own it contacts GitHub, to check for updates.
Everything else follows something you set up:

- Modrinth for mods
- CurseForge once you add an API key
- NeoForge's Maven for a loader
- Your buckets
- Cloudflare for a tunnel
- Any address an HTTP Request block names

### Where does it store my data?

Your server files stay where they are.
Konnekt's own state (servers, layouts, presets, scheduled tasks) is JSON in the OS application-data directory.

### Is it stable?

It's alpha.
The core is functional and in daily use, but expect rough edges.
The [roadmap](/roadmap.html) has what is next.

## Servers

### Which server types work?

Vanilla, Paper, Spigot and Bukkit, and modded Fabric, Forge and NeoForge.
The loader is detected automatically.
Bedrock is not supported.

### Why does the server stop as soon as I start it?

On a first run that is almost always the EULA.
Minecraft will not start until you have accepted it, and says so in the log on its way out.
Konnekt watches for that line and offers to write `eula.txt` for you, then starts the server again.

### Can I manage a server on another machine?

No, Konnekt manages servers on the machine it runs on.
[Remote Access](/docs/settings/remote-access.html) opens that machine's dashboard in a browser elsewhere.

## Updates

### Can I run the newest code?

Yes: snapshots are built from the newest code whenever it changes, and published as pre-releases.
They're untested, so Konnekt warns before installing one.
Take the first from the [download page](/download.html).
After that a snapshot offers you the next one itself, and a release once one overtakes it.
To follow snapshots from a stable build, switch the channel in **Settings**, **General**.
