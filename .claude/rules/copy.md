---
paths:
  - "frontend/src/**/*.tsx"
  - "backend/services/scheduler_blocks*.go"
  - "website/**"
  - "docs/design/website/**"
  - "README.md"
  - "CONTRIBUTING.md"
  - "SECURITY.md"
  - "docs/**/*.md"
---

# Copy a user reads

The suite's rule, from kollektiv's `docs/conventions.md` § Wording, which says
where it came from: say what the thing is, once, and stop. A reader who needs
the reason finds it in the body, a tooltip, or the docs.

- **A label names the thing.** No code glyphs or accent colour on a label
  (`[i] about`, `>_ features`, `() scheduler`), and no single word in a headline
  coloured for emphasis. A section head is a number and a title.
- **A headline says what is there, not a slogan.** "Scheduler", not "Automate
  everything".
- **No line that explains the layout.** No subtitle beside a heading, and no
  sentence telling the reader what they are about to see ("Pick the part of
  Konnekt you are working on"). A control that explains itself, a search bar,
  stands alone.
- **Header facts are fixed per kind of page, and few.** A fact that does not
  apply to every page of its kind does not belong in the header. The docs keep
  Duration, Requirements, Category and Topics.
- **A fact's label is a plain noun, its value a number and unit.** Duration, not
  Takes; Requirements, not You need; Topics, not Touches. `~20 min`, not a
  sentence. The same fact carries the same label everywhere.
- **One sentence per line in prose.** A line that wraps to leave one or two
  words gets a shorter sentence, not a wider box.

## Writing for a reader

The same section's second list, for everything written for a reader: UI text,
docs, the README, issue and pull request bodies, release notes.

- **Write what was asked for and stop.** No extra sections, subtitles, info
  boxes, tips, notes or summaries to fill space.
- **A title needs no subtitle that restates it.** A clear control needs no
  helper text.
- **Say what something does, not why the system works that way.** Explain a
  reason only when asked or when the reader would otherwise get it wrong.
- **No consequence tails.** Drop ", so ...", ", therefore ...", ", which means
  ..." and "This means ..." when they restate what the sentence implies.
- **No intros or wrap-ups:** "In this section", "Overall", "In summary", "Note
  that", "It's worth noting".
- **Delete any sentence the reader would not miss.**
- **No em dashes.** Use a comma, a colon, or two sentences.

Nothing gates these. Review does.
