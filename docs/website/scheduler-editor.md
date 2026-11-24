---
title: Scheduler editor
kind: reference
lead: The scheduler editor, opened by maximizing the **Scheduler** tile, wires blocks into graphs that run on a trigger.
shelf: scheduler
order: 4
summary: Menus, shortcuts and view options.
facts:
  Topics: Scheduler
related:
  - /docs/blocks/
  - /docs/cron.html
  - /docs/graphs.html
---

## Toolbar {#toolbar}

| Control | What it does |
| --- | --- |
| **Graph picker** | Shows the open graph. A dot on its right marks unsaved changes. Click it to list this server's graphs and open one. |
| **New graph** | In the picker. Opens a blank graph named **New graph**, which is not saved until you save it. |
| **add** | Opens the block list under the button. A pick lands at the middle of the canvas. |
| **edit** | Opens the edit menu. |
| **edit**, **Select all** | Selects every block and every wire. |
| **edit**, **Deselect all** | Clears the selection. |
| **edit**, **Select by type** | Lists the block types on the canvas. Pick one to select every block of that type. |
| **edit**, **Select by name** | Selects the blocks whose name contains the text you type. Press **Enter** to apply it. |
| **view** | Opens **Curved connectors** and **Snap to grid**. |
| Warning count | A triangle and a number. Click it to list the warnings. |
| **run** | Runs the graph now. It appears only once the graph is saved. |
| **[on]** and **[off]** | Switches the graph on or off. It appears only once the graph is saved. |
| **Graph actions** | The button with three dots. |
| **Graph actions**, **Save** | Saves the graph. It reads **Saving...** while it works. |
| **Graph actions**, **Rename** | Shows a name field. **Enter** applies the name and **Escape** backs out. |
| **Graph actions**, **Duplicate graph** | Saves the canvas as a new graph named after the old one plus copy, switched off, and opens it. |
| **Graph actions**, **Delete graph** | Deletes the open graph with no prompt, then opens a blank graph. |

```ui
# Scheduler editor
[Graph picker] | [add] | [edit] | [view] | [run] | [[on]] | [Graph actions]
```

## Keyboard shortcuts {#keyboard-shortcuts}

| Keys | Action |
| --- | --- |
| `Ctrl+Z` | Undo. The editor keeps the last 10 changes. |
| `Ctrl+Shift+Z` or `Ctrl+Y` | Redo. |
| `Ctrl+X` | Cut. Copies the selected blocks, then deletes them. |
| `Ctrl+C` | Copy. Takes the selected blocks and the wires between them. |
| `Ctrl+V` | Paste. Lands under the pointer over the canvas, and at its middle from a menu. |
| `Ctrl+D` | Duplicate. Places a copy down and to the right, and leaves the clipboard alone. |
| `Delete` or `Backspace` | Deletes the selected blocks and wires. |
| `Tab` | Opens the block list at the pointer. |
| `F1` | Open docs. Opens the selected block's page in your browser. |
| `Escape` | Closes the block list or the unsaved-changes dialog. |
| `Alt` and drag a block | Leaves a copy behind with the same wires. |

- `Ctrl` is `Cmd` on macOS.
- Undo, redo, cut, copy, paste, duplicate and `Tab` do nothing while a text field has focus.

## Adding blocks {#adding-blocks}

| Way | What happens |
| --- | --- |
| **Open blocks** | The button at the top left of the canvas. It opens the block browser, and reads **Close blocks** while open. |
| Category heads | The browser lists **trigger**, **data**, **action**, **control** and **notify**. Click a head to fold it. |
| Dashed rows | A group of blocks, such as **Distant Horizons**. Click it to show its blocks. |
| Click a block | Adds it and selects it. Each new block lands a step down and right of the one before. |
| Drag a block | Adds it centred on the drop point. |
| Hover a block | Shows the block's description. |
| **add**, `Tab` or right-click on empty canvas | Opens the quick-add list. The pick lands at the middle of the canvas, or at the pointer. |
| **search blocks…** | In the quick-add list. Matches name, category, group and description. Arrow keys move, `Enter` adds. |
| Quick-add categories | Hover a category for its blocks, and a group for the blocks inside it. |
| Right-click a block | Opens the edit rows at the pointer, acting on the selection. |

## View options {#view-options}

| Option | What it does | Default |
| --- | --- | --- |
| **Curved connectors** | Draws wires as smooth curves that enter and leave ports sideways. Off draws straight lines. | On |
| **Snap to grid** | Snaps dragged blocks and wire corners to the dots of the background grid. | Off |

- Both choices apply to every graph.
- The menu stays open while you flip them.
- Double-click a wire to add a corner.
- Drag a corner to move it, and double-click it to remove it.

```ui
# view
[*Curved connectors*]
[*Snap to grid*]
```

## Warnings {#warnings}

| Warning | Shown on | Do |
| --- | --- | --- |
| Stops the server with no warning to players: RCON is not confirmed. It is confirmed once the server has started with `enable-rcon` on. | **Command** set to **Stop Server** or **Restart Server** | Turn on `enable-rcon` and start the server once. |
| **DH Snapshot** warns players through the console, as RCON is not confirmed. It is confirmed once the server has started with `enable-rcon` on. | **DH Snapshot** | Turn on `enable-rcon` and start the server once. |
| no destination chosen. | **Upload to Bucket** and **Publish DH Snapshot** | Pick a destination in the **Destination** field. |
| the destination "*name*" does not exist. It was deleted or renamed in Settings, or this graph came from another install. | **Upload to Bucket**, **Publish DH Snapshot** and **DH Snapshot** | Pick another destination, or add the missing one in Settings. |
| keep must be a whole number of at least 1, not *value*. | **Publish DH Snapshot** | Set **Snapshots to keep** (at least 1) to a whole number. |

- Click a row to select the block and bring it into view.
- The same text shows under **warnings** on the block's **data** tab.
- Warnings do not block saving or running.

## Saving and running {#saving-and-running}

| Action | What happens |
| --- | --- |
| **Graph actions**, **Save** | Writes the blocks, wires, positions and name. A new graph gets its id here. |
| **run** | Runs the saved graph. It works on a graph that is off, and needs exactly one trigger block. |
| **run** with unsaved changes | Asks first: **Run uses the saved graph. Save your changes and run it?** The buttons are **Cancel** and **Save & run**. |
| **[on]** | The graph's triggers can fire. This is written at once, without saving the canvas. |
| **[off]** | The graph's triggers do not fire. |
| Closing the tile, switching server, switching graph or **New graph** | With unsaved changes, opens **Unsaved changes** with **Cancel**, **Discard** and **Save & continue**. `Escape` cancels. |

| Status | Meaning |
| --- | --- |
| **running…** | The run has not finished. |
| **done (N nodes)** | The run finished. *N* is the number of blocks recorded in it. |
| **already running** | This graph already has a run in progress, so nothing started. |
| **run failed** | The run failed. Click it to show the reason. It stays until clicked. |
| **scheduler error** | A save, delete or toggle was refused. Click it to show the message. |
