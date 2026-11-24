---
title: Your first server
kind: guide
lead: Point Konnekt at a server you already have, start it, and join it from Minecraft.
shelf: new-here
order: 2
summary: Add, start and join a server.
facts:
  Duration: ~10 min
  Requirements: A server jar · Java
  Topics: Servers · Console
css: /docs/first-server.css
js: /docs/first-server.js
related:
  - /docs/install.html
  - /docs/requirements.html
  - /docs/faq.html
---

## Before you start

- [ ] A server jar
      The Minecraft server you already run.
      Konnekt manages it, it does not fetch one.
- [ ] Java
      Your server needs it to run.
      Konnekt itself does not.
- [ ] RCON on in `server.properties`
      The player list and commands need `enable-rcon` until [Konnekt sets it up for you](https://github.com/kollektiv-mc/Konnekt/issues/99).

## Add a server

1. Select **Add server** beside **Servers**.
2. Set **Server file** to the jar.
3. Set **Working directory** to the folder it lives in.
4. Set **Name**.
5. Set the RAM the server gets.
6. Select **Add server**.

<figure class="demo-stage"><div class="demo" data-demo="add" aria-hidden="true"><div class="mock mock-form"><div class="mock-title">Servers</div><div class="mock-field f1"><span class="mock-type">Survival</span></div><div class="mock-field f2"><span class="mock-type">server.jar</span><span class="mock-browse">…</span></div><div class="mock-field f3"><span class="mock-type">/home/mc/survival</span ><span class="mock-browse">…</span></div><div class="mock-field f4"><span class="mock-type">-Xms1G -Xmx4G</span></div><div class="mock-btn mock-add">Add server</div><span class="mock-cursor"></span></div></div></figure>

## Install a server

Only for a Forge or NeoForge installer rather than a server jar.

1. Set **Server file** to the installer.
2. In **Installer detected**, set the install folder.
3. Select **Install server**.
4. Select **Add server**.

> [!NOTE]
> Konnekt runs the install for you, then adds what comes out.

<figure class="demo-stage"><div class="demo" data-demo="install" aria-hidden="true"><div class="mock mock-install"><div class="mock-modal"><div class="mock-modal-head"><span class="mock-info">[i]</span><span>Installer detected</span></div><div class="mock-field i1"><span class="mock-type">/home/mc/forge</span ><span class="mock-browse">…</span></div><div class="mock-install-log"><span class="il1">Running installer…</span><span class="il2">Extracting libraries</span><span class="il3">Downloading server</span></div><div class="mock-bar"><span class="mock-bar-fill"></span></div><div class="mock-modal-foot"><span class="mock-btn mock-install-btn">Install server</span><span class="mock-btn mock-added-btn">Add server</span><span class="mock-dismiss">Close</span></div></div><span class="mock-cursor"></span></div></div></figure>

## Start it

1. Select **Start**.
2. Read the log in the console.

> [!WARNING]
> A server that stops on its first run is almost always waiting for its EULA.
> Konnekt offers to write `eula.txt` for you, then starts it again.

> [!NOTE]
> The console streams the log live and takes commands inline.

<figure class="demo-stage"><div class="demo" data-demo="start" aria-hidden="true"><div class="mock mock-console"><div class="mock-console-head"><span class="mock-status s-stopped">STOPPED</span><span class="mock-status s-starting">STARTING</span><span class="mock-status s-running">RUNNING</span><span class="mock-btn mock-start">Start</span><span class="mock-btn mock-stop">Stop</span></div><div class="mock-log"><span class="l1">Starting minecraft server 1.21</span><span class="l2">Loading properties</span><span class="l3">Preparing level "world"</span><span class="l4">Done (6.129s)! For help, type "help"</span></div><span class="mock-cursor"></span></div></div></figure>

## Join it

1. In Minecraft, open **Multiplayer**.
2. Select **Direct Connection**.
3. Enter `localhost` as the **Server Address**.
4. Select **Join Server**.

> [!NOTE]
> The server runs on the machine you are sitting at, so its address is `localhost`.

<figure class="demo-stage"><div class="demo" data-demo="join" aria-hidden="true"><div class="mock mock-join"><div class="mock-join-title">Direct Connection</div><div class="mock-join-body"><div class="mock-join-label">Server Address</div><div class="mock-field j1"><span class="mock-type">localhost</span></div><div class="mock-btn mock-join-go">Join Server</div><div class="mock-btn mock-join-cancel">Cancel</div></div><span class="mock-cursor"></span></div></div></figure>
