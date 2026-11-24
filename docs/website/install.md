---
title: Install Konnekt
kind: guide
lead: Download the file for your system and open it.
shelf: new-here
order: 1
summary: Windows, macOS or Linux.
facts:
  Duration: ~5 min
  Requirements: Windows, Linux or macOS
  Topics: Download · Platforms
related:
  - /docs/first-server.html
  - /docs/requirements.html
  - /docs/faq.html
---

## Before you start

- [ ] A 64-bit Windows or Linux machine, or a Mac
      The macOS build runs on Apple silicon and Intel Macs.
- [ ] The machine your server runs on
      Konnekt manages servers on the machine it runs on.

## Download

1. Open the [download page](/download.html).
2. Take the file for your system.

| Platform | File |
| --- | --- |
| Windows | `konnekt-windows-amd64-setup.exe` |
| macOS | `konnekt-darwin-universal.dmg` |
| Linux | `konnekt-linux-amd64` |
| Fedora, Rocky and RHEL 10 | `konnekt-<version>.x86_64.rpm` |

> [!TIP]
> Which build is a release and which only a snapshot is on [Requirements and platforms](/docs/requirements.html#platform-support).

## Windows

1. Run `konnekt-windows-amd64-setup.exe`.
2. If SmartScreen warns, choose **More info**, then **Run anyway**.

> [!WARNING]
> Windows builds are not code signed yet, so a first launch shows a SmartScreen warning.

> [!NOTE]
> It installs Konnekt for your account, with a Start Menu entry and an uninstaller under Installed apps.
> It needs no administrator rights.

## macOS

1. Open `konnekt-darwin-universal.dmg`.
2. Drag Konnekt into Applications.
3. Open Konnekt.
4. If macOS refuses, open **System Settings**, then **Privacy & Security**.
5. Choose **Open Anyway** beside Konnekt.

> [!WARNING]
> macOS builds are not signed by Apple yet, so the first launch is refused.

> [!NOTE]
> One build runs on Apple silicon and Intel Macs.

## Linux

Konnekt needs `webkit2gtk4.1` and `gtk3` at runtime.
Fedora 36, Ubuntu 22.04, Debian 12, Rocky and RHEL 10, and anything newer have both.

1. Make the file executable.
2. Run it.

```
chmod +x konnekt-linux-amd64
./konnekt-linux-amd64
```

On Fedora, Rocky or RHEL 10, install the package instead.
It pulls in both libraries and adds Konnekt to your applications.

```
sudo dnf install ./konnekt-*.x86_64.rpm
```

> [!WARNING]
> Rocky and RHEL 9 are not compatible.

## Build from source

A source build is the newest code, so it is a snapshot: newer than the release, and untested.

- It needs [Go](https://go.dev/), [Node.js](https://nodejs.org/) with [pnpm](https://pnpm.io/), and the [Wails CLI](https://wails.io/docs/gettingstarted/installation).
- On Linux it also needs the `webkit2gtk` and `gtk3` development packages.

1. Run `wails doctor`, which reports what your system is missing.
2. Clone and start it.

```
git clone https://github.com/kollektiv-mc/Konnekt
cd Konnekt
pnpm install
wails dev
```

If WebKit detection fails, add the build tag.

```
wails build -tags webkit2_41
wails dev -tags webkit2_41
```

## Check the download

Every release file carries a signed build provenance attestation and a checksum.
The commands to check either are on the download page.

> [!TIP]
> See [Verify your download](/download.html#verify).
