---
paths:
  - "frontend/src/**/*.tsx"
  - "backend/services/scheduler_blocks*.go"
  - "website/**"
  - "docs/design/website/**"
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

Nothing gates these. Review does.
