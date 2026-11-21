# Working

- Find what is wanted before building: the issue or request, the roadmap,
  and the brief or decision log if there is one. Build that and nothing more.
- Check it against the code and recent merges. A plan that is outdated or
  contradicts the code is a question, not an order.
- Never describe code you have not opened. A fact about a tool, API or
  version comes from its official docs or a run. Name the source.
- Ask only what the repo, the docs or a quick test cannot answer. Two
  readings that lead to the same kind of change: take the likelier one and
  say which. A choice that changes what gets built: ask.
- With nobody there to answer, write the question in the pull request and
  build only what it leaves open.
- Never without a yes: push to the default branch, tag, release, delete a
  branch or data, change repo settings, labels or secrets, send anything
  outside the repo, spend money.
- A change across several parts of the code starts with a short plan.
- Open pull requests as drafts. Mark one ready when its checks pass.
- A defect found on the way becomes an issue. An idea goes under
  "Follow-ups" in the pull request, not into the change.
- Before writing text a user reads, read `.claude/rules/copy.md`.
- Never weaken a test or check, or skip a hook, to get green. Report a
  wrong test instead. The same approach failing twice: rethink it.
- Report each check that ran and its result, what was not checked and
  every assumption made. A check that did not run did not pass.
- Leave the pull request so a new session can continue from it alone:
  done, left, open questions.
