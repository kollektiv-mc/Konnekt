<!--
Title rules, because a merged pull request title becomes public release-notes copy:
imperative mood, sentence case, no trailing period, one line, no em dashes.
Say what changed, not which files moved. "Support NeoForge and modern Forge
servers", not "Update serverlaunch.go".

One pull request can carry several changes: list each in the Changelog
section below and the release notes list each on its own line. Split only
when a part is risky on its own, has to be revertable on its own, or ships at
a different time.
-->

## Why

<!-- The problem or need this addresses. This never reaches the release notes,
so detail is free. -->

## What changed

<!-- The shape of the change. Enough that a reviewer knows where to look. -->

## Changelog

<!--
One line per change, as public release-notes copy with the same rules as the
title. The type is feature, fix, chore, docs or skip, chosen by the test at
the bottom. chore and docs are counted in the notes, not listed.

- feature: Add servers from a plus in the Servers header
- fix: Make the world info panel opaque

Leave the section empty for a single change and the notes use the title and
the type: label instead (the pr-labelled status warns that it did).
-->

## How it was verified

<!-- What you actually ran, and what it said. Name the gates:
pnpm typecheck / lint / test / format:check, go vet ./... / go test ./...,
/suite-kit:health, or a manual check in the running app. -->

---

<!--
Which type, for each Changelog line or, without a section, for the type: label.
The type is the only thing that files a change in the release notes; nothing
reads the title for one. Ask these in order and stop at the first yes:

  1. Can a user of Konnekt tell the difference? If nothing they can see, run or
     click changed, it is type:chore - or type:docs when the change is
     documentation and nothing else. Refactors, tests, CI, tooling and
     dependency bumps stop here, however large the diff.
  2. Was Konnekt already meant to do this, and not doing it? Then it is
     type:bug, even when the repair adds new files, new bound methods or new UI.
  3. Otherwise it is type:feature: the app can now do something it never
     offered.

The revert test settles most arguments. Imagine this change reverted and ask
what the user loses. Something goes back to being broken -> type:bug. They lose
something they never had -> type:feature. They cannot tell -> type:chore.

Full version, with the cases this gets wrong: CONTRIBUTING.md.
-->

- [ ] A Changelog line per change, or a `type:` label (`type:feature`, `type:bug`, `type:docs`, `type:chore`) for a single change. Typed by the test above rather than by the verb.
- [ ] Labelled with an `area:` from `.github/labels.yml`. The `pr-labelled` status stays pending until the area and one of the two above are there. Prefer a specific area over `area:ui`, as on an issue.
- [ ] Generated files were regenerated rather than hand-edited (`frontend/wailsjs/`, the token layer, lockfiles).
