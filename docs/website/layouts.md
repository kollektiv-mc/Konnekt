---
title: Tiles and layouts
kind: concept
lead: Arrange the dashboard's tiles on a grid, then save the arrangement as a layout.
shelf: dashboard
order: 1
summary: The grid, placing tiles and saved layouts.
facts:
  Duration: ~3 min
  Topics: Tiles · Layouts
related:
  - /docs/tiles.html
  - /docs/settings/appearance.html
  - /docs/first-server.html
---

## The grid {#grid}

- The **Tiles** section of the navbar lists every tile.
- Drag a row onto the grid to place the tile where you drop it.
- Shift-click a row to place it without dragging.
- A plain click on a row maximizes the tile instead.
- Drag rows inside the section to change their order.
- Drag a tile by its header to move it.
- Drag its bottom-right corner to resize it.
- Remove a tile with the X in its header, or right-click the header and choose **Remove**.
- Double-click a tile's header, or press its maximize button, to fill the dashboard with it.
  Press **Esc** to return.

| Size | Columns | Rows |
| --- | --- | --- |
| New tile | `3` | `8` |
| Smallest | `2` | `4` |
| Largest | `6` | `16` |

- The grid has six columns, and each row is `40 px` high.
- Tiles snap to those cells and settle upward, leaving no gap over a tile.

```ui
# Tiles
Console
Overview
Players
```

## Layout per tile {#tile-layout}

- Right-click a tile's header and choose **Layout**, then **Detailed**, **Default** or **Compact**.
- **Default** sets the key figure large over the detail.
- **Detailed** sets it small and packs in more.
- **Compact** keeps the figure alone and spreads it over the tile.
- In Console, **Detailed** tightens the line spacing.
  **Compact** shows the notable lines and folds each run of the rest into one row.
- Commands, Config and Notifications have no **Layout** entry.
- A maximized tile ignores it.
- Each tile keeps its own choice, and applying a saved layout never changes it.

> [!TIP]
> The Classic tile faces setting in [Appearance](/docs/settings/appearance.html#advanced) replaces these faces.

```ui
# Right-click on a tile header
Layout | [Detailed] | [Default] | [Compact]
Maximize
Remove
```

## Saved layouts {#saved}

- The **Layouts** section of the navbar lists them, and starts collapsed.
- Default, Console Focus, Compact and Essentials come with Konnekt.
- A layout holds which tiles are on the grid, and where.
- Applying one removes any tile it does not mention, which stays in the **Tiles** section to add back.

| Layout | Holds |
| --- | --- |
| **Default** | Every tile, with room to spare. |
| **Console Focus** | The console with most of the screen, beside Overview, Commands and Players. |
| **Compact** | Every tile on one screen. |
| **Essentials** | Console, Commands, Overview, Performance, Players and Notifications on one screen, and nothing else. |

1. Click a name under **Layouts** to apply it.

To save your own:

1. Arrange the grid.
2. Type a name in the field under the list.
3. Press **Enter** or select **Save**.

- An empty field saves over the highlighted layout, whose name the field shows.
- A name that exists is replaced.
- The X beside a name deletes it, except on Default.

```ui
# Layouts
Default | Console Focus | Compact | Essentials
{Preset name...} | [*Save*]
[↺ Reset to defaults]
```

> [!WARNING]
> **↺ Reset to defaults** asks for a second click, labelled **↺ Confirm reset**, and disarms itself after `4 s`.
> It rewrites the four layouts that come with Konnekt and applies Default.
> Layouts saved under other names stay.

> [!NOTE]
> The layouts that come with Konnekt are written once, on first launch.
> A newer version's take effect after a reset.

## What is saved {#storage}

| Item | Saved | File |
| --- | --- | --- |
| Positions and sizes | After a drop, a resize, or applying a layout. | `active_layout.json` |
| Tiles on the grid | When you add or remove one. | `active_tiles.json` |
| Layout per tile | When you choose one. | `tile_layouts.json` |
| Saved layouts | When you save, delete or reset. | `layout_presets.json` |
| Order of the Tiles section | When you drop a row. | `app_settings.json` |

- The files sit in the data folder and are read again on the next launch.
- One grid serves every server: switching servers keeps the arrangement and reloads each tile.
- A first launch puts all eleven tiles on the grid in the Default layout.
