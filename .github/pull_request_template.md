<!--
Title rules, because a merged pull request title becomes public release-notes copy:
imperative mood, sentence case, no trailing period, one line, no em dashes.
Say what changed, not which files moved. "Support NeoForge and modern Forge
servers", not "Update serverlaunch.go".

Keep one pull request to one concern. The release notes list a merged pull
request once, under one heading, by its title, so a change that carries a
feature and a website pass and a CI tweak cannot be described honestly by any
single line.
-->

## Why

<!-- The problem or need this addresses. This never reaches the release notes,
so detail is free. -->

## What changed

<!-- The shape of the change. Enough that a reviewer knows where to look. -->

## How it was verified

<!-- What you actually ran, and what it said. Name the gates:
pnpm typecheck / lint / test / format:check, go vet ./... / go test ./...,
/suite-kit:health, or a manual check in the running app. -->

---

<!--
Which label. The label is the only thing that files this in the release notes;
nothing reads the title. Ask these in order and stop at the first yes:

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

- [ ] Labelled by the test above rather than by the title's verb: `type:feature`, `type:bug`, `type:docs` or `type:chore`. CI's `pr-labelled` job fails without one, and the label alone decides which release-notes section this lands in.
- [ ] One concern. A change that is honestly half repair and half new capability is two pull requests, not a judgement call.
- [ ] Generated files were regenerated rather than hand-edited (`frontend/wailsjs/`, the token layer, lockfiles).
