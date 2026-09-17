---
paths:
  - ".aislop/**"
  - ".aislopignore"
  - ".github/workflows/aislop.yml"
---

# The aislop gate

`scanaislop/aislop` (MIT, run through `npx`, nothing installed) scores the tree
for what AI-assisted code leaves behind: ignored errors, double casts,
duplicated blocks, oversized functions, `innerHTML` sinks. CI runs `aislop ci`
and fails below 100, through `.github/workflows/aislop.yml`, a shared workflow
vendored from kollektiv by its `scripts/sync-workflows.sh` and never edited
here, which pins aislop and ruff once for the whole suite.

**ruff has to be present or aislop's Python engines silently run nothing**, and
the pinned version is what the gate judges against. A newer or older ruff on
your `PATH` scores a different rule set, which is how a local run can report
100 against a tree CI then fails.

`.aislop/base.yml` is the suite's policy, vendored from kollektiv by its
`scripts/sync-aislop.sh` and never edited here: what is counted, and which two
style rules are off and why. `.aislop/config.yml` extends it (`extends:
./base.yml`, and the `./` is load-bearing) and holds only this tree's size
limits, a **ratchet** held at today's largest function and file. Lower them as
#314 shrinks the holders; never raise them.

`.aislopignore` is what is generated or vendored and never scored, the vendored
runner, the memory-budget module and the release-notes generator included: a
gate that reformatted one of those once handed the suite a week of drift.

A finding that is a documented exception gets an inline
`// aislop-ignore-next-line <rule> -- <reason>` beside it, the way a Go
`//nolint:errcheck // reason` does. A bare directive with no reason is the thing
to refuse in review.

**Never run `aislop fix`**: it deletes lines by regex and rewrites
`package.json`. Telemetry is off in the config.
