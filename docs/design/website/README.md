# Website redesign

The approved design for the next version of the website, in the "Blocks"
style: every section a bordered block with a numbered header band, square
corners, Geist and Geist Mono, on the site's `#05060a` ground and `#4ade80`
accent. Nothing here is deployed. `website/` is still the live site, and these
files are the reference a rollout builds from.

The files are artboards from a Claude Design canvas (`.dc.html`), not finished
pages: each loads the canvas runtime through `./support.js`, which is not in
this folder, so opened straight from disk they render without fonts or
interaction. To see them as designed, add the folder's files to a Design
canvas; `canvas.json` is that canvas's layout.

## Boards

| File | Page |
| --- | --- |
| [`Home.dc.html`](Home.dc.html) | Landing page |
| [`Roadmap.dc.html`](Roadmap.dc.html) | Roadmap, with alpha, beta and release stages in their colours |
| [`Changelog.dc.html`](Changelog.dc.html) | Changelog, with the nightly snapshot in gold above the releases |
| [`Docs.dc.html`](Docs.dc.html) | Docs home: search, then one band per feature with its pages split by kind |
| [`DocsGuide.dc.html`](DocsGuide.dc.html) | Template for a guide: Publish Distant Horizons LODs |
| [`DocsBlock.dc.html`](DocsBlock.dc.html) | Template for a scheduler block reference: DH Snapshot |
| [`DocsSettings.dc.html`](DocsSettings.dc.html) | Template for a settings reference: Remote Access |
| [`DocsConcept.dc.html`](DocsConcept.dc.html) | Template for a concept page: How remote access works |

The docs templates are layouts: their copy shows the shape of a page and is
to be checked against the app when the real page is written. The concept
page's "can and cannot do" table is marked as sample on the board, because its
rows have to come from the remote method allowlist.

## Decisions a rollout keeps

- **Four kinds of docs page**, told apart by the shape of a small marker
  rather than a colour: guide a filled green square, concept a green outline,
  reference a white outline, settings a dashed outline.
- **Hero facts are fixed per kind**, in this order: guide Duration
  (`~20 min`), Requirements, Topics; block reference Category, Topics;
  settings Topics; concept Duration, Topics. A fact that does not apply to
  every page of its kind does not belong in the hero.
- **One sentence per line** in docs prose, so no sentence starts on the tail
  of the one before.
- **Section heads are a number and a title**, with no subtitle beside them.
- **Port diagrams copy the scheduler editor** (`frontend/src/tiles/scheduler/editor/blockMeta.ts`):
  control ports round and coloured per port, data ports square and coloured by
  type (`string`, `number`, `bool`).
- **The docs home shows a page's one-line summary only on hover**, in a row
  that keeps its height, so nothing below it moves.
- **No coloured buzzword labels or slogan headlines**: they read as generated.

Colours and fonts reach the live site through `kollektiv/design/tokens.json`
and its sync, never by editing `website/tokens.css`.
