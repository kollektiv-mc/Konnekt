---
description: Audit the whole tree against agent_docs/SECURITY_CHECKLIST.md, run the pinned scanners, and report a table of pass, fail, skip and not-applicable per item. Use when asked for a security check, security audit or security sweep, before a milestone, and before Remote Access ships. For reviewing one diff, use /security-review instead.
argument-hint: "[section, e.g. S3 or remote]"
---

# Security check

The target is `agent_docs/SECURITY_CHECKLIST.md`. Read it in full before running
anything, then read `SECURITY.md` for what counts as in scope. The checklist
states how things must be and how to verify each one; this file is the
procedure. If the checklist is missing, say so and stop.

With an argument (`$ARGUMENTS`), check only that section or item, but still run
step 1, because a vulnerable dependency is never out of scope.

**Run every item. Do not stop at the first failure.** A traversal and a leaked
credential are different bugs, and finding one is no reason to leave the other
undiscovered.

## 1. Scanners

Run each command in the checklist's `Scanners` section from the repo root, as
written, with its pinned version. Do not substitute `@latest`: a scanner that
changes under the check changes what "pass" means.

A scanner that could not run (no network, no Go toolchain, `frontend/dist`
absent for a package that embeds it) is **skipped**, with the reason. A skip is
never a pass. Run `pnpm build` in `frontend/` first when a Go scanner needs the
embed.

gosec is triage, not a gate: it reports around sixty findings on this tree,
most of them file reads behind the S3 guards. Report the count per rule. Judge
every HIGH and every finding in a file the checklist names: is the line
reachable with input someone other than the user controls, and does the item's
guard run first? When asked to fix, encode a safe-by-design line the way
`.claude/suite.json` encodes an invariant exception, as
`// #nosec Gxxx -- reason` beside it, never a bare `#nosec`.

## 2. Checklist items

For every item, in order:

1. Run its **Verify** steps exactly. A step that names a test runs that test; a
   grep that "must find nothing" is a fail on any match until you have read the
   match and judged it against the item's intent.
2. Answer its **Probe** by reading the code the item names. Try to construct the
   input that defeats the protection. When you think you have one, prove it
   with a test in a scratch file, not a claim. Delete the scratch test
   afterwards unless asked to keep it.
3. Record `pass`, `fail`, `skip` (with reason) or `n/a` (the item's
   **Applies when** condition does not hold yet). Evidence is a `file:line`, a
   test name or a command's output, never "looks fine".

## 3. New surface

The checklist drifts as the tree grows. Look for attack surface it does not
cover yet:

- Bound methods: compare `grep -c '^func (a \*App) [A-Z]' app.go` with the count
  the checklist records. Classify each new method against the items.
- New sinks: `exec.Command`, `os.WriteFile`, `os.Create`, `os.RemoveAll`,
  `os.Rename`, `archive/zip`, `http.Get`, `http.NewRequest`, `net.Listen`,
  `BrowserOpenURL`, `dangerouslySetInnerHTML` in files the checklist does not
  name.
- New event payloads that could carry a credential.

Each uncovered surface is a finding: it names a checklist item to add.

## 4. Report

One table, every item and scanner, in checklist order:

| Item | Result | Evidence |
|---|---|---|

Then the findings, most severe first. For each: the file and line, what someone
other than the user could achieve, the input that does it, and the fix you
would propose. Severity follows impact on the user's machine: code execution,
then credential or file disclosure, then denial of service, then hardening.

Do not fix anything unless asked. Report first.

## 5. Where findings go

This repository is public. **An exploitable finding never goes into a public
issue, a commit message, a pull request or the checklist.** Tell the user and
recommend a private advisory
(`https://github.com/kollektiv-mc/Konnekt/security/advisories/new`, per
`SECURITY.md`).

A hardening gap with no reachable impact goes under the checklist's
`Open backlog`, or into a GitHub issue labelled per `CONTRIBUTING.md`. A
checklist item that turned out wrong or untestable is fixed in the checklist
itself, in the same change, with the reason.

Never edit an item's target to match what the code does. The checklist is the
target, not a snapshot.
