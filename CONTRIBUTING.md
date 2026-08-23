# Contributing to Konnekt

Konnekt is a local-first desktop dashboard for Minecraft servers. It is early
software: Alpha is complete and Beta is in progress, so bug reports and ideas
are genuinely useful right now.

There are three ways to help, in rough order of how much they are worth:
reporting something that broke, telling us what is missing, and sending code.

## Reporting a bug or asking for a feature

Everything goes through **[GitHub Issues](https://github.com/kollektiv-mc/Konnekt/issues/new/choose)**,
which will offer you a short form:

- **Bug report** — something is broken or behaves unexpectedly.
- **Feature request** — Konnekt should be able to do something it cannot.
- **Question or something else** — you need help, or it is not clearly either
  of the above.

**You do not need to be technical to file a good report.** The forms only
require things you can see: what you were doing, what you expected, which
version, which operating system, and roughly which part of the app. Logs, error
text and stack traces are all optional, and each field says where to find the
thing it is asking for if you want to include it. "Not sure" is a real answer,
and a screenshot dragged into the form is often worth more than any of it.

One thing to leave out: your `server.properties` file. It contains your RCON
password.

Found a security vulnerability? Do not open an issue. See
[SECURITY.md](SECURITY.md).

## What happens after you file

Every new issue arrives labelled `status:needs-triage`. From there it gets one
of:

| Label | Meaning |
| --- | --- |
| `status:needs-info` | We asked you something and the issue is waiting on your reply. |
| `status:confirmed` | Reproduced, or accepted as in scope. It is now on the list. |
| *closed* | Duplicate, out of scope, or not a Konnekt bug. Always with a reason and a link. |

Triage also puts three labels on it: what kind of change it is (`type:`), which
part of the app it touches (`area:`), and how urgent it is (`p0`-`p3`). Nothing
is expected of you here. The form already asks which part of Konnekt you mean,
and the rest is our reading of it.

We may also retitle the issue. Titles here are kept to a short noun phrase with
the area left to the label, because the
[roadmap page](https://konnekt.pages.dev/roadmap.html) lists them in a tree
grouped by area and a title that repeats it reads badly there. That is a
housekeeping edit, not a judgement on how you wrote it, and it never changes
what you reported.

An issue closed as out of scope is not a brush-off.
[`agent_docs/ROADMAP.md`](agent_docs/ROADMAP.md) sets what Konnekt is trying to
be, and its final section records the things that have been deliberately ruled
out and why, so that they are not re-argued from scratch every time. If your
idea lands there, the close will link to the reasoning.

Issues are the only tracker. There is a read-only Linear mirror for internal
planning; nothing should ever be filed there.

## Contributing code

Start from an issue. For anything beyond a small fix, comment on it first so
nobody builds the same thing twice, and so a large change is not written
against a design that was already decided differently.

Setup, prerequisites and the dev loop are in the
[README](README.md#getting-started). Architecture, conventions and the full
command list live in
[`agent_docs/CLAUDE.md`](agent_docs/CLAUDE.md); it is worth a read before a
first change, because a few things are load-bearing in ways that are not
obvious from the code.

Run the gates before you open a pull request:

```bash
cd frontend
pnpm typecheck && pnpm lint && pnpm test && pnpm format:check
cd ..
go vet ./... && go test ./...
```

### Pull requests

Merged pull request titles become the public release notes, so a title is
copy, not a note to a reviewer.

- **Title:** imperative mood, sentence case, no trailing period, one line, no
  em dashes. Say what changed, not which files moved.
- **Label it** `type:feature`, `type:bug`, `type:docs` or `type:chore`. This is
  required, CI fails without it, and the label alone decides which section of
  the release notes the change lands in. Which one to use is below.
- **One pull request, one concern.** The notes list a merged pull request once,
  under one heading, by its title. A change carrying a feature *and* a website
  pass *and* a CI tweak cannot be described honestly by any single line.
- **Body:** why the change exists and how you verified it. The body never
  reaches the notes, so detail is free.

### Which `type:` label

The label is the only input to the release notes. Nothing reads the title, and
nothing infers a category from a verb, so the label is a statement of fact
rather than a preference. Ask these in order and stop at the first yes:

1. **Can a user of Konnekt tell the difference?** If nothing they can see, run
   or click changed, it is `type:chore`, or `type:docs` when the change is
   documentation and nothing else. Refactors, tests, CI, tooling and dependency
   bumps stop here, however large the diff.
2. **Was Konnekt already meant to do this, and not doing it?** Then it is
   `type:bug`. "Already meant to" covers anything the UI offers, the docs
   describe or the app plainly implies, including things that fail silently.
3. **Otherwise it is `type:feature`:** the app can now do something it never
   offered.

Where this goes wrong in practice:

- **The size of the diff is not the test.** A repair that needed a new file, a
  new bound method and a new row of UI is still `type:bug`. #97 "Write a log
  file a bug reporter can attach" went into the notes as a feature for exactly
  that reason and it was wrong: the app was already writing diagnostics, a
  packaged build with no terminal was throwing them away, and the change is the
  repair.
- **A new surface built in service of a repair belongs to the repair.** The
  Settings > About row showing the log path exists so that fix is usable. It is
  not a separate feature.
- **The title's verb is not the test.** "Add", "Write" and "Support" open
  plenty of fixes, and "Fix" opens the occasional refactor.
- **The revert test settles most arguments.** Imagine the change reverted and
  ask what the user loses. Something goes back to being broken is `type:bug`.
  They lose something they never had is `type:feature`. They cannot tell is
  `type:chore`.
- **One concern per pull request is what makes this answerable at all.** A
  change that is honestly half repair and half new capability is two pull
  requests, not a judgement call.

`changelog:skip` is separate from all of this: it leaves a pull request out of
the notes entirely, for work that fits no section and is not worth a line. It
does not replace a `type:` label, which CI still requires.

### Things not to edit by hand

Some files in the tree are generated. Editing them looks like it works and is
reverted by the next run:

- `frontend/wailsjs/` — Wails IPC bindings. Regenerate with
  `wails generate module` after changing a bound Go method.
- `frontend/src/styles/tokens.css`, `frontend/src/styles/tokens.ts` and
  `website/tokens.css` — the design token layer, generated by `pnpm gen:tokens`
  from a source shared with other projects. A token value is changed upstream,
  never here.
- `frontend/pnpm-lock.yaml` — pnpm owns its layout.

CI checks all of these, so a hand edit shows up as a failing job rather than a
surprise later.

## Code of conduct

Be decent to people. This is a small project and there is no formal process
yet; if someone is making it unpleasant, say so in an issue or privately, and
it will be dealt with.
