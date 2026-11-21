---
paths:
  - ".copier-answers.yml"
  - ".claude/suite-check.py"
  - ".claude/suite-probe.py"
  - ".claude/suite-memory.py"
  - ".aislop/base.yml"
  - ".github/workflows/**"
  - ".github/scripts/release-notes.py"
  - ".github/scripts/changelog-section.py"
  - ".claude/rules/writing.md"
  - ".claude/rules/simplicity.md"
  - ".claude/rules/typography.md"
  - ".claude/rules/template-files.md"
  - ".claude/rules/working.md"
  - ".claude/rules/copy.md"
---

# Files that come from AllesSandro

This repo was created from sandrogekeler/AllesSandro and is kept in step with it
by Renovate (`.copier-answers.yml` records the version). Two kinds of file:

- **Locked** (re-applied on every template update): `.claude/suite-*.py`,
  `.github/workflows/{codeql,scorecard,pr-labelled,labels,template-guard,issue-priority}.yml`
  (CodeQL and Scorecard only on a public repo) and the optional `aislop.yml`,
  `claude.yml`, `.aislop/base.yml`, `.github/scripts/changelog-section.py`,
  `.github/scripts/release-notes.py`,
  `.claude/rules/{template-files,working,writing,copy,simplicity,typography}.md`. A local
  edit is kept but shows up as a merge conflict on the next template update.
- **Seeded** (created once, owned by this repo): everything else.

Locked paths are owned by sandrogekeler/AllesSandro. Change the template, tag a
release there, and let the update PR bring the change here. Do not edit
`.copier-answers.yml` by hand: Copier uses it to compute the next update.

## A template-update PR has conflict markers

Renovate opens "Update AllesSandro template to vX.Y.Z" PRs. When this repo had
changed a line the template also changed, the file arrives with:

```
  <<<<<<< before updating
  (this repo's version)
  =======
  (the template's new version)
  >>>>>>> after updating
```

(shown indented here so this file does not trip the guard; in a real conflict
the markers start at column 0)

and the PR shows a red `renovate/artifacts` check, an "Artifact update problem"
comment listing the files, and a red `template-guard` check. To resolve:

1. Check out the PR branch.
2. For each file, keep this repo's version, take the template's, or combine them.
   Remove every marker line.
3. If the local change is meant to stay for good, say so in the PR and either
   move the change into AllesSandro or ask for the file to become seeded for
   this project. Resolving the same conflict on every update is the signal.
4. Push. `template-guard` must be green before merging.

Renovate's code notes that Copier sometimes reports conflicts that are not real:
check the diff before assuming something was lost.
