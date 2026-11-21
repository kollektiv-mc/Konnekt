# Simplicity and wording

Code is the smallest thing that does today's job.

- No abstraction with one user. An interface, factory, wrapper or generic
  helper arrives with its second caller, not its first.
- No option nobody sets. A parameter, flag or config field with one value in
  use is a constant until a second value is needed.
- No second way. A change that does something the codebase already does
  reuses that path, or replaces it in the same change.
- No code without a caller. An export, file, branch or fallback that nothing
  reaches goes in the change that orphaned it.
- A comment says why, never what the line beneath it says. An error or log
  line states the failure; advice goes in the docs.
- Before changing a function, find every caller, test and config it reaches.
  Fix a bug once, in the shared code.
- New logic with a branch, loop, parser or data write gets one small test.
- A known limit gets a comment: `shortcut: <the limit>, <when to revisit>`.
- Never cut for size: input validation, data-loss handling, security,
  accessibility.

A name is a noun phrase, a message is a sentence or two, and the reason goes in
the comment, the tooltip or the docs.

- A test function name is at most 60 characters: the thing under test and the
  one condition. The full sentence goes in a comment or a subtest name.
- A label that is scanned (palette block, tab, menu entry, chip) is at most 20
  characters and never wraps. The full name goes in its description.
- A message that shares a line with controls stays on one line: at most 140
  characters, truncated with the full text in a tooltip.
