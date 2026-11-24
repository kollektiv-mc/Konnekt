---
title: Appearance
kind: settings
lead: The look of the dashboard: skin, colors, fonts, scrolling and hardware acceleration.
shelf: settings
order: 1
summary: Skins, colors, fonts and GPU use.
facts:
  Topics: Skins · Colors · Fonts · Hardware acceleration
related:
  - /docs/settings/general.html
  - /docs/settings/remote-access.html
  - /docs/requirements.html
  - /docs/layouts.html
---

## Look {#look}

```ui
# Settings · Appearance
Skin | [Default]
Mode | [Light] | [Dark] | [System]
Accent color | [Green]
Background | [Solid] | [Gradient]
Hardware acceleration | [On] | [On demand] | [Off]
```

| Setting | What it does | Default |
| --- | --- | --- |
| **Skin** | Six palettes for surfaces and borders: Default, Midnight, Nord, Solarized, Mocha and Forest. | Default |
| **Mode** | Light, Dark, or System, which follows the operating system, with Light on the Default skin only. | Dark |
| **Accent color** | Colors highlights and active states, from six presets or a custom picker. | `#4ade80` |
| **Background** | Solid, or Gradient, a faint accent glow from the top right corner. | Solid |

- Picking a skin also sets its accent color: Green for Default and Forest, Violet for Midnight, Blue for Nord, Rose for Solarized and Amber for Mocha.
  Change the accent afterwards to override it.
- Every skin except Default is dark only, and **Light** is greyed out on them.
  Picking one while **Mode** is **Light** switches **Mode** to **Dark**.
- With **System**, those skins stay dark whatever the operating system prefers.

## Hardware acceleration {#hardware-acceleration}

**Hardware acceleration** is a Linux setting.
It sets how the window's webview, WebKitGTK, uses the GPU.
Windows, macOS and a [Remote Access](/docs/settings/remote-access.html) browser do not use it, so the row is hidden there.

| Option | What it does |
| --- | --- |
| **On** | The GPU always draws and scrolls the window, as WebKitGTK does by default. |
| **On demand** | The page content decides when the GPU is used. |
| **Off** | The CPU draws every frame, with no GPU compositing. |

- A fresh install uses **On**.
- A change applies after you restart Konnekt.
  Until then the row shows **Applies on the next launch.**
- With **On** or **On demand**, Konnekt turns off WebKitGTK's DMA-BUF transport on the proprietary NVIDIA driver.
  Acceleration stays on, and frames pass through shared memory instead.
  A `WEBKIT_DISABLE_DMABUF_RENDERER` you set yourself is left alone.
- The environment variable `KONNEKT_WEBVIEW_GPU` wins over the row while it is set.
  Its values are `always`, `ondemand` and `never`.

> [!TIP]
> Step down to **On demand**, then **Off**, if the window flickers, tears or runs the GPU hot.

If the window is blank at launch, Settings is out of reach.

1. Set `KONNEKT_WEBVIEW_GPU` to `never` and start Konnekt.
2. Open Settings, then **Appearance**.
3. Set **Hardware acceleration** to **Off**.
4. Close Konnekt, remove the variable, and start it again.

## Advanced {#advanced}

```ui
# Settings · Appearance
[*Advanced*]
Fonts | [Body] | [Titles] | [Wordmark] | [Code]
Status colors | [Success] | [Warning] | [Error]
Smooth scrolling | [On]
Classic tile faces | [Off]
```

| Setting | What it does | Default |
| --- | --- | --- |
| **Fonts** | Sets the font family for **Body**, **Titles**, **Wordmark** and **Code**. | Default |
| **Status colors** | Sets the **Success**, **Warning** and **Error** colors, each from a few presets or a custom picker. | `#22c55e`, `#f59e0b`, `#f87171` |
| **Smooth scrolling** | Glides under each mouse wheel notch on spring physics instead of stepping. | On |
| **Classic tile faces** | Shows the compact tile faces from before the figure-first ones. | Off |

- **Fonts**: pick an installed font or type any name for each of the four.
  An empty field keeps the default, and a name that is not installed falls back to it.
  **Wordmark** is the Konnekt name in the title bar.
- **Fonts** is desktop only: a [Remote Access](/docs/settings/remote-access.html) browser cannot list this computer's fonts, so the row is hidden there.
- **Status colors** left at their defaults use darker values in Light mode.
  A color you pick is used as is.
- **Smooth scrolling** leaves touchpads, Ctrl or Shift scrolling and the operating system's reduced-motion setting alone.
  It takes effect on the next wheel notch, with no restart.
- **Classic tile faces** applies to the Overview, Players, Performance, Scheduler, Worlds, Backups and Plugins tiles.
  Their layout options do not change a classic face.
