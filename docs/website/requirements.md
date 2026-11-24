---
title: Requirements and platforms
kind: reference
lead: Konnekt needs a 64-bit computer and the server you already run.
shelf: new-here
order: 3
summary: What runs where.
facts:
  Topics: Platforms · Java · Server jars
js: /docs/requirements.js
related:
  - /docs/install.html
  - /docs/first-server.html
  - /docs/faq.html
---

## Requirements

| Requirement | Why |
| --- | --- |
| A server jar | The Minecraft server you already run. Konnekt manages it, it does not fetch one. |
| Java | Your *server* needs it to run. Konnekt itself does not. |
| Windows, Linux or macOS | 64-bit Windows and Linux; on a Mac, Apple silicon or Intel. |

## Platform support {#platform-support}

<div class="doc-table-wrap">
<table class="doc-table" id="platforms-table">
<thead><tr><th scope="col">Platform</th><th scope="col">Build</th><th scope="col">Status</th></tr></thead>
<tbody>
<tr data-platform="windows"><td>Windows (x86-64)</td><td><code>konnekt-windows-amd64-setup.exe</code></td><td data-stage="alpha"><span class="status"><span class="marker" aria-hidden="true"></span>ALPHA</span></td></tr>
<tr data-platform="linux"><td>Linux (x86-64)</td><td><code>konnekt-linux-amd64</code></td><td data-stage="alpha"><span class="status"><span class="marker" aria-hidden="true"></span>ALPHA</span></td></tr>
<tr data-platform="fedora"><td>Fedora, Rocky and RHEL 10 (x86-64)</td><td><code>.x86_64.rpm</code></td><td data-stage="alpha"><span class="status"><span class="marker" aria-hidden="true"></span>ALPHA</span></td></tr>
<tr data-platform="mac"><td>macOS (Apple silicon and Intel)</td><td><code>konnekt-darwin-universal.dmg</code></td><td data-stage="alpha"><span class="status"><span class="marker" aria-hidden="true"></span>ALPHA</span></td></tr>
</tbody>
</table>
</div>

- Rocky and RHEL 9 are not compatible.
- Linux needs `webkit2gtk4.1` and `gtk3` at runtime: Fedora 36, Ubuntu 22.04, Debian 12, Rocky and RHEL 10, and anything newer.
- On macOS, Konnekt does not update itself yet, and Remote Access has no tunnel.
  Download each new `.dmg` from the [download page](/download.html).

## Server types

| Type | Servers |
| --- | --- |
| Plain and plugin | Vanilla, Paper, Spigot and Bukkit |
| Modded | Fabric, Forge and NeoForge |
| Not supported | Bedrock |

The loader is detected automatically.
