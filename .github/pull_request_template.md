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

- [ ] Labelled `type:feature`, `type:bug`, `type:docs` or `type:chore`. CI's `pr-labelled` job fails without one, and the label alone decides which release-notes section this lands in.
- [ ] One concern.
- [ ] Generated files were regenerated rather than hand-edited (`frontend/wailsjs/`, the token layer, lockfiles).
