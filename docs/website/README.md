# Website docs sources

Each `<path>.md` here is the source of `website/docs/<path>.html`.
`node scripts/gen-docs.mjs` writes the pages and the docs home's shelves; CI's
website job fails when they are stale. Edit the Markdown, never the HTML.
The block pages under `website/docs/blocks/` come from `gen-block-docs.mjs`
instead: their ports and fields from the block registry, and the sections after
the fields from `blocks/<page>.md` here, in the same Markdown without front
matter (`## What a run does {#run}`, `## Errors {#errors}`).

After a change, run in order:

```sh
node scripts/gen-block-docs.mjs      # block pages, from blocks/*.md
node scripts/gen-docs.mjs            # or --page <file>.md while writing one page
node scripts/gen-docs-search.mjs     # the search index reads the pages
```

## Front matter

```yaml
---
title: Publish Distant Horizons LODs
kind: guide # guide | concept | reference | settings
lead: One sentence that says what the page gets you.
shelf: tutorials # new-here | tutorials | dashboard | scheduler | settings
order: 3 # place on the shelf
summary: Share a world's LODs from a bucket. # the docs home's line, a few words
facts:
  Duration: ~20 min
  Requirements: A Distant Horizons server · A destination
  Topics: Distant Horizons · Destinations · Scheduler
related:
  - /docs/r2-bucket.html
  - /docs/blocks/action-dhSnapshot.html
css: /docs/first-server.css # optional, extra stylesheets
js: /docs/first-server.js # optional, extra scripts
---
```

`facts` are the header facts. A guide has Duration, Requirements and Topics; a
concept Duration and Topics; a reference and a settings page Topics.

## Sections

`## Heading` starts a numbered section. Its id is the heading in kebab case;
`## Heading {#id}` sets it. Keep an id that other pages link to (`grep -rn
'html#<id>' website`). A section headed `Before you start` is numbered 00.

## Blocks

| Write                            | Get                                                        |
| -------------------------------- | ---------------------------------------------------------- |
| `1.` `2.` lines                  | Numbered steps, one action each                            |
| `- ` lines                       | Points: facts that stand alone                             |
| `- [ ] Thing` + indented lines   | A "Before you start" check, the indented lines its detail  |
| Lines of text                    | Prose, one sentence a line                                 |
| `> [!WARNING]` + `> ` lines      | Heads up: the thing not to miss                            |
| `> [!NOTE]` + `> ` lines         | Note: context, quieter than the steps                      |
| `> [!TIP]` + `> ` lines          | Tip: where to read more, or a shortcut                     |
| `\| a \| b \|` table             | A table                                                    |
| `### Question?` + answer         | A question that opens to its answer (FAQ)                  |
| `### Heading` (no `?`)           | A sub-heading inside the section                           |
| A line starting with `<`         | Raw HTML up to the next blank line; `<figure` goes beside  |
| ` ```flow ` and the others below | A picture drawn beside the section's words                 |

An indented line under a step, point or check continues it on a new line.
Inline: `**bold**` for UI names, `*em*`, `` `code` ``, `[text](/docs/x.html)`.

## Pictures

A section with a picture lays out as words on the left and the picture on the
right, picture first on a phone. A leading `* ` marks the part the step adds.

````md
```flow
Cron Schedule: 0 4 * * *
[onComplete]
Condition: A == 0
<- Read Attribute: players.count
[onTrue]
* Create Backup: Full server
-> [onComplete] Notify: Backup done
-> [onFailed] Notify: Backup failed
```
````

`flow` draws a scheduler graph top to bottom: `Kind: value` is a block and its
setting, `[port]` names the wire to the next block, `<- Kind: value` is a data
block feeding the block above, `-> [port] Kind: value` is a branch from the
last block.

````md
```tree
bucket/
  latest.json  # the newest snapshot
  snapshots/
    * 20261012T040000Z/  # one snapshot
```

```timeline
-60 s: say The server restarts in 1 minute
* 0: Restart Server
```

```ui
# Mods
42 mods | [Pack] | [*Add Content*]
{https://…/pack.toml} | [Save]
```
````

`tree` is folders and files, two spaces a level, `# note` beside one.
`timeline` is `when: what`, in order. `ui` sketches a panel: `# Title`, then
rows of cells split by ` | `: text, `[button]` or `{field}`, with `[*b*]` or
`{*f*}` marking the control to use. Sketch only controls that exist, with
their labels as the app shows them.

## Layout by kind

- **guide**: `Before you start`, then one section per stage of the job, then
  `When it refuses`. Each stage: its numbered steps, at most one Heads up, a
  Note for context, and a picture of the result so far (`flow` with the new
  block marked, or a `ui` sketch of where to click). A guide that builds a
  graph opens with `What you build`, the finished graph.
- **concept**: one section per idea, as points, with a picture where the idea
  has a shape (a graph, a folder, an order in time).
- **reference**: tables, with a sentence or two above where a table needs it.
- **settings**: what the pane holds, then its fields as a table, then errors.
- **block** (`blocks/*.md`): `What a run does` as numbered steps in the order
  the block works, points for what stands alone, which port it leaves by, a
  Heads up for what stops a server or loses data, and a `flow` of the block
  wired in a typical graph with the block marked. Then `Errors` as a table.

## Writing

`.claude/rules/writing.md` and `.claude/rules/copy.md` apply. On top of them:

- A step is one action, starting with the verb: "Select **Save**." The
  result of an action goes in a Note, not in the step.
- A Heads up is what costs the reader something if missed: downtime, lost
  data, a refused run. One per section at most. Everything else is a Note.
- A Note never repeats a step, and a point never holds an action.
- UI names in bold, as the app spells them. Values, files and commands in code.
- Every fact comes from the current page or the code. Nothing is invented,
  and nothing true is dropped without a reason.
