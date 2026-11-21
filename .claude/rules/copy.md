---
paths:
  - "**/*.{html,css,scss,svg}"
  - "**/*.{jsx,tsx,vue,svelte,astro}"
  - "**/*.md"
---

# Copy a user reads

On websites, in apps and in docs for users: say what the thing is, once, and
stop. Docs for developers (READMEs, agent docs, code docs, pull requests) may
explain how a part works and why.

- Say what something does, not why the system works that way. Explain a reason
  only when asked or when the reader would otherwise get it wrong.
- A feature says what the user can do with it. Leave out how it works, numbers
  and limits, where it shows up, and anything a user expects anyway:
  "Export: Save the report as a PDF", not "Renders the report to an A4 PDF in
  under 2 s. Works with long tables".
- A label names the thing. No code glyphs or accent colour on a label
  (`[i] about`, `>_ features`), and no single word in a headline coloured
  for emphasis.
- A headline says what is there, not a slogan: "Scheduler", not "Automate
  everything".
- No line that explains the layout: no subtitle beside a heading, no sentence
  telling the reader what they are about to see. A control that explains
  itself, like a search bar, stands alone.
- Header facts are fixed per kind of page, and few. A fact that does not apply
  to every page of its kind does not belong in the header.
- A header fact's label is a plain noun, its value a number and unit: "Duration
  ~20 min", not "Takes about twenty minutes". The same fact carries the same
  label on every page.
- One sentence per line in prose, and no sentence starts on the tail of the
  one before. A line that wraps to leave one or two words gets a shorter
  sentence, not a wider box.
